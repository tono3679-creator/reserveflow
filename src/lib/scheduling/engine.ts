/**
 * 空き枠エンジン（決定論的なルールベース。AI API は使わない）。
 *
 * 予約できる条件
 *   1. 店舗の営業時間内（サービスの時間 [開始, 終了) が営業時間に収まる）
 *   2. 定休日・臨時休業ではない
 *   3. スタッフが勤務している（曜日の基本勤務。特定日の勤務変更があればそちら）
 *   4. スタッフが対象サービスに対応している
 *   5. 休憩・休暇と重ならない
 *   6. 既存予約と重ならない（占有時間 = 前後バッファを含む）
 *   7. サービスの所要時間を確保できる
 *   8. 前後バッファも既存予約と重ならない
 *   9. 必要な設備のどれか1つが空いている
 *  10. 受付の締め切り（開始の N 分前まで）と受付期間（N 日先まで）を満たす
 *
 * ここで「空いている」と判定しても予約の保証にはしない。確定時はサーバーで同じ判定をやり直し、
 * 最後は DB の排他制約が同時予約を防ぐ。
 */
import { addDays, diffDays, localDate, toMinutes, weekdayOf, zonedDateTime } from "@/lib/time";
import type {
  BusyBooking, Interval, ServiceSpec, SchedulingContext, SlotIssue, StaffInfo,
} from "./types";

const MINUTE = 60_000;

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

function contains(outer: Interval, inner: Interval): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

function range(date: string, from: string, to: string, tz: string): Interval {
  return { start: zonedDateTime(date, from, tz).getTime(), end: zonedDateTime(date, to, tz).getTime() };
}

/** その日の営業時間（定休日・臨時休業なら空） */
export function businessWindows(ctx: SchedulingContext, date: string): Interval[] {
  const exception = ctx.exceptions.find((e) => e.date === date);
  if (exception) {
    if (exception.isClosed || !exception.opens || !exception.closes) return [];
    return [range(date, exception.opens, exception.closes, ctx.timezone)];
  }
  const weekday = weekdayOf(date);
  return ctx.businessHours
    .filter((h) => h.weekday === weekday)
    .sort((a, b) => toMinutes(a.opens) - toMinutes(b.opens))
    .map((h) => range(date, h.opens, h.closes, ctx.timezone));
}

export type StaffDay = { windows: Interval[]; breaks: Interval[]; dayOff: boolean; working: boolean };

/** その日のスタッフの勤務時間（休憩を除いた時間帯）と休憩 */
export function staffDay(ctx: SchedulingContext, staff: StaffInfo, date: string): StaffDay {
  const off = staff.timeOff.find((t) => t.date === date);
  if (off?.kind === "day_off") return { windows: [], breaks: [], dayOff: true, working: false };
  if (off?.kind === "custom_hours" && off.start && off.end) {
    return { windows: [range(date, off.start, off.end, ctx.timezone)], breaks: [], dayOff: false, working: true };
  }
  const schedule = staff.schedules.find((s) => s.weekday === weekdayOf(date));
  if (!schedule) return { windows: [], breaks: [], dayOff: false, working: false };
  const work = range(date, schedule.start, schedule.end, ctx.timezone);
  if (!schedule.breakStart || !schedule.breakEnd) return { windows: [work], breaks: [], dayOff: false, working: true };
  const brk = range(date, schedule.breakStart, schedule.breakEnd, ctx.timezone);
  return {
    windows: [{ start: work.start, end: brk.start }, { start: brk.end, end: work.end }].filter((w) => w.end > w.start),
    breaks: [brk],
    dayOff: false,
    working: true,
  };
}

/** 予約の占有時間（前後バッファを含む） */
export function occupiedOf(service: Pick<ServiceSpec, "bufferBeforeMinutes" | "bufferAfterMinutes">, start: number, end: number): Interval {
  return { start: start - service.bufferBeforeMinutes * MINUTE, end: end + service.bufferAfterMinutes * MINUTE };
}

function busyFor(bookings: BusyBooking[], exclude?: string) {
  return bookings.filter((b) => b.id !== exclude);
}

/** 必要な設備のうち空いているもの（並び順の最初）。設備が不要なら null、空きがなければ undefined */
export function freeResource(ctx: SchedulingContext, service: ServiceSpec, occupied: Interval, excludeBookingId?: string): string | null | undefined {
  if (service.resourceIds.length === 0) return null;
  const busy = busyFor(ctx.bookings, excludeBookingId);
  const order = ctx.resources.map((r) => r.id).filter((id) => service.resourceIds.includes(id));
  return order.find((id) => !busy.some((b) => b.resourceIds.includes(id) && overlaps(b, occupied)));
}

/**
 * 指定した枠の問題点を返す（空なら予約できる）。
 * 管理画面では「営業時間外」などは確認したうえで登録でき、重なり・設備の不足は DB が必ず拒否する。
 */
export function checkSlot(
  ctx: SchedulingContext,
  service: ServiceSpec,
  slot: { staffId: string | null; start: number; end: number; excludeBookingId?: string; now?: number; enforceBookingWindow?: boolean },
): SlotIssue[] {
  const issues: SlotIssue[] = [];
  const tz = ctx.timezone;
  const date = localDate(new Date(slot.start), tz);
  const target: Interval = { start: slot.start, end: slot.end };
  const occupied = occupiedOf(service, slot.start, slot.end);

  const windows = businessWindows(ctx, date);
  if (windows.length === 0) issues.push({ code: "closed_day", message: "この日は定休日（休業日）です" });
  else if (!windows.some((w) => contains(w, target))) issues.push({ code: "outside_hours", message: "営業時間外の時間が含まれています" });

  if (slot.staffId === null) {
    if (ctx.staffSelection === "required") issues.push({ code: "staff_required", message: "担当スタッフを選んでください" });
  } else {
    const staff = ctx.staff.find((s) => s.id === slot.staffId);
    if (!staff || !service.staffIds.includes(slot.staffId)) {
      issues.push({ code: "staff_not_assigned", message: "このスタッフはこのサービスを担当していません" });
    }
    if (staff) {
      const day = staffDay(ctx, staff, date);
      if (day.dayOff) issues.push({ code: "staff_day_off", message: `${staff.name}さんはこの日お休みです` });
      else if (!day.working) issues.push({ code: "staff_outside_hours", message: `${staff.name}さんはこの日の勤務がありません` });
      else if (day.breaks.some((b) => overlaps(b, target))) issues.push({ code: "staff_break", message: `${staff.name}さんの休憩時間と重なっています` });
      else if (!day.windows.some((w) => contains(w, target))) issues.push({ code: "staff_outside_hours", message: `${staff.name}さんの勤務時間外です` });
      const conflict = busyFor(ctx.bookings, slot.excludeBookingId).some((b) => b.staffId === slot.staffId && overlaps(b, occupied));
      if (conflict) issues.push({ code: "staff_conflict", message: `${staff.name}さんの別の予約と時間が重なっています（準備時間を含む）` });
    }
  }

  if (freeResource(ctx, service, occupied, slot.excludeBookingId) === undefined) {
    issues.push({ code: "resource_unavailable", message: "この時間に使える設備が空いていません" });
  }

  if (slot.enforceBookingWindow && slot.now !== undefined) {
    if (slot.start < slot.now) issues.push({ code: "in_past", message: "過去の時刻は予約できません" });
    else if (slot.start < slot.now + ctx.minLeadMinutes * MINUTE) issues.push({ code: "lead_time", message: `開始の${ctx.minLeadMinutes}分前を過ぎているため予約できません` });
    const today = localDate(new Date(slot.now), tz);
    if (diffDays(today, date) > ctx.maxAdvanceDays) issues.push({ code: "too_far_ahead", message: `${ctx.maxAdvanceDays}日先までの予約を受け付けています` });
  }
  return issues;
}

/** 重なり・設備の不足のように、確認しても登録できない問題か */
export function isBlocking(issue: SlotIssue): boolean {
  return issue.code === "staff_conflict" || issue.code === "resource_unavailable" || issue.code === "staff_required"
    || issue.code === "staff_not_assigned" || issue.code === "in_past" || issue.code === "lead_time" || issue.code === "too_far_ahead";
}

export type OpenSlot = { date: string; start: number; end: number; staffId: string | null; resourceId: string | null };

/**
 * 指定した日に予約できる枠をすべて列挙する（開始は枠の刻みにそろえる）。
 * staffId を指定するとそのスタッフだけ、"any" / null なら対応できる全スタッフ、指名なしの店舗では担当者なしの枠。
 */
export function openSlots(
  ctx: SchedulingContext,
  service: ServiceSpec,
  options: { date: string; staffId?: string | "any" | null; now: number; window?: { from: string; to: string }; excludeBookingId?: string },
): OpenSlot[] {
  const { date } = options;
  const tz = ctx.timezone;
  const today = localDate(new Date(options.now), tz);
  if (diffDays(today, date) < 0 || diffDays(today, date) > ctx.maxAdvanceDays) return [];
  const windows = businessWindows(ctx, date);
  if (windows.length === 0) return [];

  const staffCandidates: (StaffInfo | null)[] = ctx.staffSelection === "none"
    ? [null]
    : ctx.staff.filter((s) => service.staffIds.includes(s.id) && (!options.staffId || options.staffId === "any" || options.staffId === s.id));

  const step = ctx.slotIntervalMinutes * MINUTE;
  const duration = service.durationMinutes * MINUTE;
  const earliest = options.now + ctx.minLeadMinutes * MINUTE;
  const limit = options.window ? range(date, options.window.from, options.window.to, tz) : null;
  const busy = busyFor(ctx.bookings, options.excludeBookingId);
  const result: OpenSlot[] = [];

  for (const staff of staffCandidates) {
    const staffWindows = staff ? staffDay(ctx, staff, date).windows : windows;
    for (const bw of windows) {
      for (const sw of staffWindows) {
        const from = Math.max(bw.start, sw.start);
        const to = Math.min(bw.end, sw.end);
        // 枠の刻みは営業開始の時刻を基準にそろえる
        let start = bw.start + Math.ceil((from - bw.start) / step) * step;
        for (; start + duration <= to; start += step) {
          const end = start + duration;
          if (start < earliest) continue;
          if (limit && (start < limit.start || start >= limit.end)) continue;
          const occupied = occupiedOf(service, start, end);
          if (staff && busy.some((b) => b.staffId === staff.id && overlaps(b, occupied))) continue;
          const resourceId = freeResource(ctx, service, occupied, options.excludeBookingId);
          if (resourceId === undefined) continue;
          result.push({ date, start, end, staffId: staff?.id ?? null, resourceId });
        }
      }
    }
  }
  return result.sort((a, b) => a.start - b.start || String(a.staffId).localeCompare(String(b.staffId)));
}

/** 期間内の日付の一覧 */
export function datesBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}
