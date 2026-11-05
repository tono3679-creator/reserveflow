import "server-only";
import type { Tx } from "@/lib/db";
import { loadSchedulingContext } from "@/lib/scheduling/load";
import { addDays, dayRange, localDate } from "@/lib/time";
import { freeWindows } from "./capacity";
import { buildInsights, type Insight } from "./insights";
import { byGroup, byTime, daily, monthly, repeatSummary, summary, utilization, type MonthRow, type Summary, type RepeatSummary, type GroupRow, type DayRow, type BucketRow } from "./metrics";
import { periodRange, previousPeriod, resolvePeriod, type Period } from "./period";

export type DashboardData = {
  today: string;
  periods: { mtd: Period; prevMtd: Period; last30: Period; prev30: Period; last90: Period };
  todaySummary: Summary;
  lastWeekSameDay: Summary;
  mtd: Summary;
  prevMtd: Summary;
  last30: Summary;
  prev30: Summary;
  repeat30: RepeatSummary;
  repeatPrev30: RepeatSummary;
  utilization30: number | null;
  utilizationPrev30: number | null;
  utilizationBasis: "staff" | "resource" | "none";
  months: MonthRow[];
  days: DayRow[];
  weekdays: BucketRow[];
  services: GroupRow[];
  insights: Insight[];
};

/** ダッシュボードの数値（オーナー・マネージャー）。すべて実際の予約データから計算する */
export async function getDashboard(tx: Tx, locationId: string, timezone: string, now = new Date()): Promise<DashboardData> {
  const today = localDate(now, timezone);
  const mtd = resolvePeriod({ preset: "this_month" }, today).period;
  const last30 = resolvePeriod({ preset: "last_30" }, today).period;
  const last90 = resolvePeriod({ preset: "last_90" }, today).period;
  const prevMtd = previousPeriod(mtd);
  const prev30 = previousPeriod(last30);
  const weeks8: Period = { from: addDays(today, -56), to: addDays(today, -1) };
  const tomorrow = addDays(today, 1);
  const r = (p: Period) => periodRange(p, timezone);
  const todayRange = dayRange(today, timezone);
  const lastWeek = dayRange(addDays(today, -7), timezone);

  const [
    todaySummary, lastWeekSameDay, mtdS, prevMtdS, last30S, prev30S, repeat30, repeatPrev30,
    util30, utilPrev30, util8w, months, days, weekdays, services, tomorrowCtx,
  ] = await Promise.all([
    summary(tx, locationId, { lo: todayRange.start, hi: todayRange.end }, now),
    summary(tx, locationId, { lo: lastWeek.start, hi: lastWeek.end }, now),
    summary(tx, locationId, r(mtd), now),
    summary(tx, locationId, r(prevMtd), now),
    summary(tx, locationId, r(last30), now),
    summary(tx, locationId, r(prev30), now),
    repeatSummary(tx, locationId, r(last30)),
    repeatSummary(tx, locationId, r(prev30)),
    utilization(tx, locationId, timezone, last30, now),
    utilization(tx, locationId, timezone, prev30, now),
    utilization(tx, locationId, timezone, weeks8, now),
    monthly(tx, locationId, timezone, 12, now),
    daily(tx, locationId, timezone, last30),
    byTime(tx, locationId, timezone, r(last90), "weekday", now),
    byGroup(tx, locationId, r(last90), "service", now),
    loadSchedulingContext(tx, locationId, tomorrow, tomorrow),
  ]);

  const services30 = await byGroup(tx, locationId, r(last30), "service", now);
  const top = services30[0];
  const free = tomorrowCtx ? freeWindows(tomorrowCtx, tomorrow, now.getTime()) : [];
  const staffIds = new Set(tomorrowCtx?.staff.map((s) => s.id) ?? []);
  const insights = buildInsights({
    timezone,
    weekday: util8w?.byWeekday ?? [],
    weekdayOverall: util8w?.rate ?? null,
    repeat: { current: { visitors: repeat30.visitors, rate: repeat30.repeatRate }, previous: { visitors: repeatPrev30.visitors, rate: repeatPrev30.repeatRate } },
    noShow: { current: { target: last30S.noShow.target, rate: last30S.noShow.noShowRate }, previous: { target: prev30S.noShow.target, rate: prev30S.noShow.noShowRate } },
    tomorrow: { date: tomorrow, free: free.map((f) => ({ ownerName: f.ownerName, isStaff: staffIds.has(f.ownerId), start: f.start, end: f.end })) },
    topService: top ? { name: top.name, bookings: top.bookings, total: last30S.bookings } : null,
  });

  return {
    today,
    periods: { mtd, prevMtd, last30, prev30, last90 },
    todaySummary, lastWeekSameDay, mtd: mtdS, prevMtd: prevMtdS, last30: last30S, prev30: prev30S,
    repeat30, repeatPrev30,
    utilization30: util30?.rate ?? null, utilizationPrev30: utilPrev30?.rate ?? null, utilizationBasis: util30?.basis ?? "none",
    months, days, weekdays, services, insights,
  };
}
