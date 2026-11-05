/**
 * 分析の対象期間（店舗のタイムゾーンでの日付。from〜to の両端を含む）。
 * 画面・サーバー・テストで共通に使うので、サーバー専用の処理は含めない。
 */
import { addDays, diffDays, zonedDateTime } from "@/lib/time";

export type Period = { from: string; to: string };

export const PERIOD_PRESETS = ["this_month", "last_month", "last_30", "last_90", "last_180", "last_365", "custom"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PRESET_LABELS: Record<PeriodPreset, string> = {
  this_month: "今月（今日まで）",
  last_month: "先月",
  last_30: "直近30日",
  last_90: "直近90日",
  last_180: "直近180日",
  last_365: "直近1年",
  custom: "期間を指定",
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 731;

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function addMonths(date: string, months: number): string {
  const [y, m] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  return t.toISOString().slice(0, 10);
}

function lastDayOfMonth(date: string): string {
  return addDays(addMonths(monthStart(date), 1), -1);
}

/** 画面の指定（URL のパラメータ）から期間を決める。不正な値は既定（直近90日）にする */
export function resolvePeriod(
  input: { preset?: string; from?: string; to?: string },
  today: string,
  fallback: PeriodPreset = "last_90",
): { preset: PeriodPreset; period: Period } {
  const preset = (PERIOD_PRESETS as readonly string[]).includes(input.preset ?? "") ? (input.preset as PeriodPreset) : fallback;
  switch (preset) {
    case "this_month": return { preset, period: { from: monthStart(today), to: today } };
    case "last_month": {
      const from = addMonths(monthStart(today), -1);
      return { preset, period: { from, to: lastDayOfMonth(from) } };
    }
    case "last_30": return { preset, period: { from: addDays(today, -29), to: today } };
    case "last_90": return { preset, period: { from: addDays(today, -89), to: today } };
    case "last_180": return { preset, period: { from: addDays(today, -179), to: today } };
    case "last_365": return { preset, period: { from: addDays(today, -364), to: today } };
    case "custom": {
      const from = input.from && DATE.test(input.from) ? input.from : null;
      const to = input.to && DATE.test(input.to) ? input.to : null;
      if (!from || !to || from > to || diffDays(from, to) >= MAX_DAYS) return resolvePeriod({ preset: fallback }, today, fallback);
      return { preset, period: { from, to } };
    }
  }
}

export function periodDays(p: Period): number {
  return diffDays(p.from, p.to) + 1;
}

/**
 * 比べる期間。
 *   1か月の中に収まり、月の初日から始まる期間 … 前の月の同じ範囲（今月1日〜5日 → 先月1日〜5日、先月 → 先々月。先月が短ければ月末まで）
 *   それ以外 … 直前の同じ日数
 */
export function previousPeriod(p: Period): Period {
  if (p.from.endsWith("-01") && p.from.slice(0, 7) === p.to.slice(0, 7)) {
    const from = addMonths(p.from, -1);
    const days = periodDays(p);
    const end = addDays(from, days - 1);
    const monthEnd = lastDayOfMonth(from);
    // 丸1か月（または今月の途中まで）を、前の月の同じ範囲と比べる
    if (p.to === lastDayOfMonth(p.from)) return { from, to: monthEnd };
    return { from, to: end > monthEnd ? monthEnd : end };
  }
  const days = periodDays(p);
  return { from: addDays(p.from, -days), to: addDays(p.from, -1) };
}

/** 期間 → UTC の [lo, hi) */
export function periodRange(p: Period, timezone: string): { lo: Date; hi: Date } {
  return { lo: zonedDateTime(p.from, "00:00", timezone), hi: zonedDateTime(addDays(p.to, 1), "00:00", timezone) };
}

export function formatPeriod(p: Period): string {
  const f = (d: string) => `${Number(d.slice(0, 4))}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
  return p.from === p.to ? f(p.from) : `${f(p.from)}〜${f(p.to)}`;
}

/** n か月前の月初〜今月末までの月（'YYYY-MM'） */
export function monthsEnding(today: string, count: number): string[] {
  const start = addMonths(monthStart(today), -(count - 1));
  return Array.from({ length: count }, (_, i) => addMonths(start, i).slice(0, 7));
}
