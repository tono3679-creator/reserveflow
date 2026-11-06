/**
 * スマート空き枠提案（決定論的なルールベース。AI API は使わない。画面にも DB にも依存しない）。
 *
 * 1. 候補の探索：空き枠エンジン（src/lib/scheduling/engine.ts の openSlots）で、予約できる枠だけを列挙する。
 *    営業時間・定休日・勤務・担当サービス・休憩・休暇・既存予約・所要時間・前後バッファ・設備・受付期限の10条件は
 *    すべて openSlots が判定する（予約登録の判定と同じ実装）。
 * 2. スコアリング：次の4項目をそれぞれ 0〜1 で評価し、店舗設定の重みで加重平均して 0〜100 点にする。
 *    - 希望時刻との近さ   … 希望時刻との差（4時間で0）と、希望日からの日数（1日ごとに −0.25）
 *    - 隙間の少なさ       … 枠の前後に、使いにくい半端な空き時間を残さないか（前後それぞれで評価）
 *    - スタッフ稼働率の平準化 … その日の担当スタッフの稼働率が低いほど高い
 *    - 店舗の未利用時間の削減 … その時間帯に手が空いているスタッフ（設備）の割合が高いほど高い
 *    評価できない項目（希望時刻の指定がない、スタッフのいない店舗など）は、重みごと計算から外す。
 * 3. 同じ開始時刻の候補はスコアの高い1件にまとめ、スコアの高い順に並べる。
 * 4. おすすめ理由は、実際に計算した値（間の分数・稼働率・人数など）からだけ作る。
 *
 * ここで出した候補は予約の保証ではない。予約の登録時にサーバーで同じ判定をやり直し、最後は DB の排他制約が守る。
 */
import { capacity } from "@/lib/analytics/capacity";
import { businessWindows, occupiedOf, openSlots, overlaps, staffDay, type OpenSlot } from "@/lib/scheduling/engine";
import type { Interval, SchedulingContext, ServiceSpec } from "@/lib/scheduling/types";
import { addDays, localTime, zonedDateTime } from "@/lib/time";

const MINUTE = 60_000;

export type SuggestionWeights = { preferredTime: number; gap: number; balance: number; idle: number };
export const DEFAULT_WEIGHTS: SuggestionWeights = { preferredTime: 40, gap: 30, balance: 20, idle: 10 };

export type FactorKey = keyof SuggestionWeights;
export const FACTOR_LABELS: Record<FactorKey, string> = {
  preferredTime: "希望時刻との近さ",
  gap: "隙間の少なさ",
  balance: "スタッフ稼働率の平準化",
  idle: "店舗の未利用時間の削減",
};

/** 評価の基準（docs と画面の注記にも出す） */
export const SCORING_RULES = {
  /** 希望時刻との差がこの分数で「近さ」が 0 になる */
  proximityZeroMinutes: 240,
  /** 希望日から1日離れるごとに「近さ」から引く値 */
  dayPenalty: 0.25,
} as const;

export type SuggestionRequest = {
  /** 希望日（この日から searchDays 日分を探す） */
  date: string;
  searchDays: number;
  /** 希望時間帯（開始時刻がこの範囲の枠だけ） */
  window?: { from: string; to: string };
  /** 希望時刻（任意） */
  preferredTime?: string;
  /** 希望スタッフ（任意。未指定なら対応できる全員） */
  staffId?: string | null;
  count: number;
  now: number;
  /** この店舗で最も短いサービスの占有時間（分）。これより短い空きは「使いにくい隙間」とみなす */
  minUsableMinutes: number;
};

export type FactorResult = { key: FactorKey; value: number; weight: number; points: number };

export type Suggestion = OpenSlot & {
  score: number;
  factors: FactorResult[];
  reasons: string[];
  staffName: string | null;
  resourceName: string | null;
};

type Edge = "booking" | "shift" | "break" | "open";
type Side = { gap: number; edge: Edge };

/** 枠の前後の空き（同じスタッフ、スタッフがいなければ同じ設備の予約・勤務の区切りまで） */
function sides(ctx: SchedulingContext, service: ServiceSpec, slot: OpenSlot): { before: Side; after: Side } | null {
  const occupied = occupiedOf(service, slot.start, slot.end);
  let windows: Interval[];
  let breaks: Interval[] = [];
  let busy: Interval[];
  if (slot.staffId) {
    const staff = ctx.staff.find((s) => s.id === slot.staffId);
    if (!staff) return null;
    const day = staffDay(ctx, staff, slot.date);
    windows = day.windows;
    breaks = day.breaks;
    busy = ctx.bookings.filter((b) => b.staffId === slot.staffId);
  } else if (slot.resourceId) {
    windows = businessWindows(ctx, slot.date);
    busy = ctx.bookings.filter((b) => b.resourceIds.includes(slot.resourceId as string));
  } else {
    return null;
  }
  const window = windows.find((w) => w.start <= slot.start && slot.end <= w.end);
  if (!window) return null;
  const isBreakEnd = breaks.some((b) => b.end === window.start);
  const isBreakStart = breaks.some((b) => b.start === window.end);

  let before: Side = { gap: Math.max(0, occupied.start - window.start), edge: isBreakEnd ? "break" : slot.staffId ? "shift" : "open" };
  let after: Side = { gap: Math.max(0, window.end - occupied.end), edge: isBreakStart ? "break" : slot.staffId ? "shift" : "open" };
  for (const b of busy) {
    if (b.end <= occupied.start && b.end > window.start) {
      const gap = occupied.start - b.end;
      if (gap <= before.gap) before = { gap, edge: "booking" };
    }
    if (b.start >= occupied.end && b.start < window.end) {
      const gap = b.start - occupied.end;
      if (gap <= after.gap) after = { gap, edge: "booking" };
    }
  }
  return { before: { ...before, gap: before.gap / MINUTE }, after: { ...after, gap: after.gap / MINUTE } };
}

/** 片側の評価：枠の刻みより短い空き = 詰めて置けている(1)、使いにくい半端な空き(0)、ほかの予約が入る余地がある(0.5) */
function sideScore(gap: number, step: number, minUsable: number): number {
  if (gap < step) return 1;
  if (gap < minUsable) return 0;
  return 0.5;
}

function beforeText(side: Side): string {
  const gap = side.gap > 0 ? `（間 ${Math.round(side.gap)}分）` : "";
  switch (side.edge) {
    case "booking": return `既存予約の直後${gap}に配置できるため、空き時間を減らせます`;
    case "break": return `休憩明けの直後${gap}に配置できます`;
    case "shift": return `勤務開始の直後${gap}に配置できます`;
    case "open": return `営業開始の直後${gap}に配置できます`;
  }
}

function afterText(side: Side): string {
  const gap = side.gap > 0 ? `（間 ${Math.round(side.gap)}分）` : "";
  switch (side.edge) {
    case "booking": return `次の予約の直前${gap}まで埋められるため、空き時間を減らせます`;
    case "break": return `休憩の直前${gap}まで埋められます`;
    case "shift": return `勤務終了の直前${gap}まで埋められます`;
    case "open": return `営業終了の直前${gap}まで埋められます`;
  }
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function suggestSlots(ctx: SchedulingContext, service: ServiceSpec, request: SuggestionRequest, weights: SuggestionWeights): Suggestion[] {
  const tz = ctx.timezone;
  const step = ctx.slotIntervalMinutes;
  const minUsable = Math.max(request.minUsableMinutes, step);
  const dates = Array.from({ length: Math.max(1, request.searchDays) }, (_, i) => addDays(request.date, i));
  const useStaff = ctx.staff.length > 0 && ctx.staffSelection !== "none";
  const staffName = new Map(ctx.staff.map((s) => [s.id, s.name]));
  const resourceName = new Map(ctx.resources.map((r) => [r.id, r.name]));

  const scored: Suggestion[] = [];
  dates.forEach((date, dayIndex) => {
    const slots = openSlots(ctx, service, { date, staffId: request.staffId ?? "any", now: request.now, window: request.window });
    if (slots.length === 0) return;
    const cap = capacity(ctx, [date]);
    const staffRate = new Map(cap.byStaff.filter((s) => s.availableMinutes > 0).map((s) => [s.staffId, s.rate ?? 0]));
    const eligible = service.staffIds.filter((id) => staffRate.has(id));
    const eligibleAvg = eligible.length > 0 ? eligible.reduce((sum, id) => sum + (staffRate.get(id) ?? 0), 0) / eligible.length : null;
    const preferred = request.preferredTime ? zonedDateTime(date, request.preferredTime, tz).getTime() : null;

    for (const slot of slots) {
      const values: Partial<Record<FactorKey, number>> = {};
      const reasons: string[] = [];

      // 希望時刻との近さ
      if (preferred !== null) {
        const diff = Math.abs(slot.start - preferred) / MINUTE;
        values.preferredTime = Math.max(0, 1 - diff / SCORING_RULES.proximityZeroMinutes - SCORING_RULES.dayPenalty * dayIndex);
        const day = dayIndex === 0 ? "" : `希望日の${dayIndex}日後・`;
        reasons.push(diff === 0 ? `${day}希望時刻（${request.preferredTime}）ちょうどです` : `${day}希望時刻（${request.preferredTime}）から${Math.round(diff)}分${slot.start > preferred ? "後" : "前"}です`);
      } else if (dates.length > 1) {
        values.preferredTime = Math.max(0, 1 - SCORING_RULES.dayPenalty * dayIndex);
      }
      if (dayIndex === 0 && dates.length > 1 && preferred === null) reasons.push("希望日の枠です");

      // 隙間の少なさ
      const s = sides(ctx, service, slot);
      if (s) {
        values.gap = (sideScore(s.before.gap, step, minUsable) + sideScore(s.after.gap, step, minUsable)) / 2;
        if (s.before.gap < step && s.after.gap < step && s.before.edge === "booking" && s.after.edge === "booking") {
          reasons.push("前後の予約の間に収まり、空き時間を残しません");
        } else {
          if (s.before.gap < step) reasons.push(beforeText(s.before));
          else if (s.after.gap < step) reasons.push(afterText(s.after));
        }
        const leftover = [s.before, s.after].filter((x) => x.gap >= step && x.gap < minUsable);
        if (leftover.length > 0) reasons.push(`前後に ${leftover.map((x) => `${Math.round(x.gap)}分`).join("・")}の短い空きが残ります`);
      }

      // スタッフ稼働率の平準化
      if (useStaff && slot.staffId && staffRate.has(slot.staffId)) {
        const rate = staffRate.get(slot.staffId) ?? 0;
        values.balance = Math.max(0, 1 - rate);
        if (eligible.length > 1 && eligibleAvg !== null && rate < eligibleAvg) {
          reasons.push(`${staffName.get(slot.staffId)}さんはこの日の稼働率が ${pct(rate)} と、対応できるスタッフの平均（${pct(eligibleAvg)}）より低めです`);
        }
      }

      // 店舗の未利用時間の削減：その時間に勤務中（設備なら営業中）のうち、手が空いている割合
      const target = { start: slot.start, end: slot.end };
      const owners = useStaff
        ? ctx.staff.filter((st) => staffDay(ctx, st, date).windows.some((w) => overlaps(w, target)))
            .map((st) => ({ busy: ctx.bookings.some((b) => b.staffId === st.id && overlaps(b, target)) }))
        : ctx.resources.map((r) => ({ busy: ctx.bookings.some((b) => b.resourceIds.includes(r.id) && overlaps(b, target)) }));
      const totalOwners = useStaff ? ctx.staff.length : ctx.resources.length;
      if (totalOwners > 1 && owners.length > 0) {
        const idle = owners.filter((o) => !o.busy).length;
        values.idle = idle / owners.length;
        if (owners.length > 1 && idle / owners.length >= 0.5) {
          reasons.push(`この時間帯は${useStaff ? "勤務中のスタッフ" : "設備"} ${owners.length}${useStaff ? "人" : "つ"}のうち ${idle}${useStaff ? "人" : "つ"}が空いており、店舗の未利用時間を埋められます`);
        }
      }

      const keys = (Object.keys(values) as FactorKey[]).filter((k) => weights[k] > 0);
      const totalWeight = keys.reduce((sum, k) => sum + weights[k], 0);
      const factors: FactorResult[] = keys.map((k) => {
        const value = values[k] as number;
        return { key: k, value, weight: weights[k], points: totalWeight > 0 ? (weights[k] * value * 100) / totalWeight : 0 };
      });
      const score = totalWeight > 0 ? factors.reduce((sum, f) => sum + f.points, 0) : 0;
      scored.push({
        ...slot, score, factors, reasons,
        staffName: slot.staffId ? staffName.get(slot.staffId) ?? null : null,
        resourceName: slot.resourceId ? resourceName.get(slot.resourceId) ?? null : null,
      });
    }
  });

  // 同じ開始時刻はスコアの高い1件にまとめる（同点なら早い日時・スタッフの並び順）
  const order = (a: Suggestion, b: Suggestion) => b.score - a.score || a.start - b.start;
  const best = new Map<number, Suggestion>();
  for (const s of [...scored].sort(order)) if (!best.has(s.start)) best.set(s.start, s);
  return [...best.values()].sort(order).slice(0, Math.max(1, request.count));
}

/** 候補の日時の表示用（店舗のタイムゾーン） */
export function slotTimes(s: Pick<OpenSlot, "start" | "end">, tz: string): { start: string; end: string } {
  return { start: localTime(new Date(s.start), tz), end: localTime(new Date(s.end), tz) };
}
