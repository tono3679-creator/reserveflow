/**
 * 予約枠の稼働率 = 予約で埋まった時間 ÷ 予約を受けられる時間。
 *   スタッフがいる店舗 … スタッフごとの勤務時間（休憩・休暇を除く）のうち、そのスタッフの予約の占有時間（前後の準備時間を含む）
 *   スタッフがいない店舗（レンタルスペースなど）… 設備ごとの営業時間のうち、その設備を使う予約の占有時間
 * 勤務時間・営業時間の外にはみ出した予約は、はみ出した分を数えない（率が 100% を超えないように）。
 * 画面にも DB にも依存しない（入力は空き枠エンジンと同じ SchedulingContext）。
 */
import { businessWindows, staffDay } from "@/lib/scheduling/engine";
import type { Interval, SchedulingContext } from "@/lib/scheduling/types";
import { weekdayOf } from "@/lib/time";

export type Capacity = {
  basis: "staff" | "resource" | "none";
  availableMinutes: number;
  bookedMinutes: number;
  rate: number | null;
  /** 曜日（0=日曜）ごと */
  byWeekday: { weekday: number; availableMinutes: number; bookedMinutes: number; rate: number | null }[];
  /** スタッフごと（basis が staff のとき） */
  byStaff: { staffId: string; availableMinutes: number; bookedMinutes: number; rate: number | null }[];
};

function overlapMinutes(windows: Interval[], busy: Interval[]): number {
  let total = 0;
  for (const w of windows) {
    for (const b of busy) {
      const s = Math.max(w.start, b.start);
      const e = Math.min(w.end, b.end);
      if (e > s) total += e - s;
    }
  }
  return total / 60_000;
}

const span = (windows: Interval[]) => windows.reduce((s, w) => s + (w.end - w.start), 0) / 60_000;

export function capacity(ctx: SchedulingContext, dates: string[]): Capacity {
  const basis: Capacity["basis"] = ctx.staff.length > 0 && ctx.staffSelection !== "none" ? "staff" : ctx.resources.length > 0 ? "resource" : "none";
  const week = Array.from({ length: 7 }, (_, weekday) => ({ weekday, availableMinutes: 0, bookedMinutes: 0 }));
  const perStaff = new Map<string, { availableMinutes: number; bookedMinutes: number }>();
  for (const date of dates) {
    const wd = week[weekdayOf(date)];
    if (basis === "staff") {
      for (const s of ctx.staff) {
        const windows = staffDay(ctx, s, date).windows;
        const busy = ctx.bookings.filter((b) => b.staffId === s.id);
        const a = span(windows);
        const b = overlapMinutes(windows, busy);
        wd.availableMinutes += a;
        wd.bookedMinutes += b;
        const acc = perStaff.get(s.id) ?? { availableMinutes: 0, bookedMinutes: 0 };
        acc.availableMinutes += a;
        acc.bookedMinutes += b;
        perStaff.set(s.id, acc);
      }
    } else if (basis === "resource") {
      const windows = businessWindows(ctx, date);
      for (const r of ctx.resources) {
        wd.availableMinutes += span(windows);
        wd.bookedMinutes += overlapMinutes(windows, ctx.bookings.filter((b) => b.resourceIds.includes(r.id)));
      }
    }
  }
  const rate = (b: number, a: number) => (a > 0 ? b / a : null);
  const availableMinutes = week.reduce((s, w) => s + w.availableMinutes, 0);
  const bookedMinutes = week.reduce((s, w) => s + w.bookedMinutes, 0);
  return {
    basis,
    availableMinutes,
    bookedMinutes,
    rate: rate(bookedMinutes, availableMinutes),
    byWeekday: week.map((w) => ({ ...w, rate: rate(w.bookedMinutes, w.availableMinutes) })),
    byStaff: [...perStaff].map(([staffId, v]) => ({ staffId, ...v, rate: rate(v.bookedMinutes, v.availableMinutes) })),
  };
}

/**
 * その日の空き時間（スタッフ・設備ごとの、予約の入っていない連続した時間帯）。長い順。
 * from より前（いまより前など）は空きとして数えない。
 */
export function freeWindows(ctx: SchedulingContext, date: string, from = 0): { ownerId: string; ownerName: string; start: number; end: number }[] {
  const out: { ownerId: string; ownerName: string; start: number; end: number }[] = [];
  const cut = (windows: Interval[], busy: Interval[]) => {
    let free = windows.map((w) => ({ start: Math.max(w.start, from), end: w.end })).filter((w) => w.end > w.start);
    for (const b of busy) {
      free = free.flatMap((w) => {
        if (b.end <= w.start || b.start >= w.end) return [w];
        return [{ start: w.start, end: b.start }, { start: b.end, end: w.end }].filter((x) => x.end > x.start);
      });
    }
    return free;
  };
  const useStaff = ctx.staff.length > 0 && ctx.staffSelection !== "none";
  if (useStaff) {
    for (const s of ctx.staff) {
      for (const w of cut(staffDay(ctx, s, date).windows, ctx.bookings.filter((b) => b.staffId === s.id))) out.push({ ownerId: s.id, ownerName: s.name, ...w });
    }
  } else {
    const windows = businessWindows(ctx, date);
    for (const r of ctx.resources) {
      for (const w of cut(windows, ctx.bookings.filter((b) => b.resourceIds.includes(r.id)))) out.push({ ownerId: r.id, ownerName: r.name, ...w });
    }
  }
  return out.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
}
