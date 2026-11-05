import "server-only";
import type { Tx } from "@/lib/db";
import type { BookingStatus } from "@/lib/domain/booking";
import { datesBetween } from "@/lib/scheduling/engine";
import { loadSchedulingContext } from "@/lib/scheduling/load";
import { localDate } from "@/lib/time";
import { capacity, type Capacity } from "./capacity";
import { monthsEnding, periodRange, type Period } from "./period";
import { ratio } from "./rates";

/**
 * 分析の集計（すべて実際の予約データから SQL で計算する）。定義は docs/features.md の「分析の定義」と同じ。
 *
 *   対象の予約 … 開始予定時刻が対象期間に含まれる予約（店舗のタイムゾーンで日付を判定）
 *   予約件数   … 対象の予約のうち、顧客キャンセル・店舗キャンセルを除いたもの（無断キャンセルは含む）
 *   来店       … 来店済み・サービス完了
 *   売上       … 来店した予約の料金の合計（予定の料金。実際の入金額ではない）
 *   平均客単価 … 売上 ÷ 来店件数
 *   無断キャンセル率 … 無断キャンセル ÷ 母数。母数は「開始予定がいまより前」の対象の予約から店舗キャンセルを除いたもの
 *                     （将来の予約と店舗都合のキャンセルは母数に入れない）
 *   顧客キャンセル率 … 顧客キャンセル ÷ 同じ母数
 *   推定機会損失額   … 無断キャンセルになった予約の予定料金の合計
 *   リピート率 … 対象期間に来店した顧客のうち、期間の終わりまでの累計来店（この店舗）が2回以上の顧客の割合（顧客は重複して数えない）
 *
 * RLS の効いた接続で呼ぶ（オーナー・マネージャーは店舗のすべての予約が見える）。
 */

const VISIT = ["checked_in", "completed"] as const;
const CANCELLED = ["cancelled_customer", "cancelled_store"] as const;

type Range = { lo: Date; hi: Date };

export type Summary = {
  bookings: number;
  visits: number;
  sales: number;
  avgPrice: number | null;
  /** 枠を占有している予約（予約確定・来店済み・完了）の件数と料金（「見込み」） */
  active: number;
  expected: number;
  noShow: NoShowSummary;
  statusCounts: Record<BookingStatus, number>;
};

export type NoShowSummary = {
  /** 母数：開始予定がいまより前の対象の予約（店舗キャンセルを除く） */
  target: number;
  noShows: number;
  customerCancels: number;
  lostAmount: number;
  noShowRate: number | null;
  customerCancelRate: number | null;
};

function noShowOf(r: { target: number; no_shows: number; customer_cancels: number; lost: number }): NoShowSummary {
  return {
    target: r.target, noShows: r.no_shows, customerCancels: r.customer_cancels, lostAmount: r.lost,
    noShowRate: ratio(r.no_shows, r.target), customerCancelRate: ratio(r.customer_cancels, r.target),
  };
}

/** 「いまより前」の境目：期間の終わりといまの早いほう */
const cutOf = (range: Range, now: Date) => (range.hi < now ? range.hi : now);

export async function summary(tx: Tx, locationId: string, range: Range, now = new Date()): Promise<Summary> {
  const cut = cutOf(range, now);
  const [r] = await tx<{
    bookings: number; visits: number; sales: number; active: number; expected: number;
    target: number; no_shows: number; customer_cancels: number; lost: number; status_counts: Record<BookingStatus, number> | null;
  }[]>`
    select count(*) filter (where b.status <> all (${CANCELLED}::public.booking_status[]))::int bookings,
           count(*) filter (where b.status = any (${VISIT}::public.booking_status[]))::int visits,
           coalesce(sum(b.price) filter (where b.status = any (${VISIT}::public.booking_status[])), 0)::int sales,
           count(*) filter (where public.booking_blocks_slot(b.status))::int active,
           coalesce(sum(b.price) filter (where public.booking_blocks_slot(b.status)), 0)::int expected,
           count(*) filter (where b.starts_at < ${cut} and b.status <> 'cancelled_store')::int target,
           count(*) filter (where b.starts_at < ${cut} and b.status = 'no_show')::int no_shows,
           count(*) filter (where b.starts_at < ${cut} and b.status = 'cancelled_customer')::int customer_cancels,
           coalesce(sum(b.price) filter (where b.starts_at < ${cut} and b.status = 'no_show'), 0)::int lost,
           (select jsonb_object_agg(status, n) from (
              select status, count(*)::int n from public.bookings
               where location_id = ${locationId} and starts_at >= ${range.lo} and starts_at < ${range.hi} group by status) s) status_counts
      from public.bookings b
     where b.location_id = ${locationId} and b.starts_at >= ${range.lo} and b.starts_at < ${range.hi}`;
  const statusCounts = { confirmed: 0, checked_in: 0, completed: 0, cancelled_customer: 0, cancelled_store: 0, no_show: 0, ...(r.status_counts ?? {}) };
  return {
    bookings: r.bookings, visits: r.visits, sales: r.sales, avgPrice: r.visits > 0 ? Math.round(r.sales / r.visits) : null,
    active: r.active, expected: r.expected, noShow: noShowOf(r), statusCounts,
  };
}

export type RepeatSummary = {
  visitors: number;
  repeaters: number;
  repeatRate: number | null;
  newCustomers: number;
  visits: number;
  avgVisits: number | null;
  /** 期間内の来店について、その顧客の前回の来店からの日数の平均 */
  avgIntervalDays: number | null;
  intervalSamples: number;
};

export async function repeatSummary(tx: Tx, locationId: string, range: Range): Promise<RepeatSummary> {
  const [r] = await tx<{ visitors: number; repeaters: number; new_customers: number; visits: number; avg_interval: number | null; interval_samples: number }[]>`
    with v as (
      select b.customer_id, b.starts_at,
             lag(b.starts_at) over (partition by b.customer_id order by b.starts_at) prev
        from public.bookings b
       where b.location_id = ${locationId} and b.status = any (${VISIT}::public.booking_status[]) and b.starts_at < ${range.hi}
    ), per as (
      select customer_id, count(*) total, min(starts_at) first_at, count(*) filter (where starts_at >= ${range.lo}) in_period
        from v group by customer_id
    )
    select (select count(*)::int from per where in_period > 0) visitors,
           (select count(*)::int from per where in_period > 0 and total >= 2) repeaters,
           (select count(*)::int from per where in_period > 0 and first_at >= ${range.lo}) new_customers,
           (select coalesce(sum(in_period), 0)::int from per) visits,
           (select avg(extract(epoch from starts_at - prev) / 86400)::float8 from v where prev is not null and starts_at >= ${range.lo}) avg_interval,
           (select count(*)::int from v where prev is not null and starts_at >= ${range.lo}) interval_samples`;
  return {
    visitors: r.visitors, repeaters: r.repeaters, repeatRate: ratio(r.repeaters, r.visitors), newCustomers: r.new_customers,
    visits: r.visits, avgVisits: r.visitors > 0 ? r.visits / r.visitors : null,
    avgIntervalDays: r.avg_interval, intervalSamples: r.interval_samples,
  };
}

/**
 * 休眠顧客数（いま時点）：この店舗に来店したことがあり、最後の来店から休眠の日数（顧客セグメントの基準）以上たち、
 * 今後の予約もない顧客。顧客一覧のセグメントと同じ条件。
 */
export async function dormantCount(tx: Tx, locationId: string, dormantDays: number, now = new Date()): Promise<number> {
  const [r] = await tx<{ n: number }[]>`
    select count(*)::int n from (
      select b.customer_id, max(b.starts_at) filter (where b.status = any (${VISIT}::public.booking_status[])) last_visit,
             bool_or(public.booking_blocks_slot(b.status) and b.starts_at >= ${now}) has_next
        from public.bookings b where b.location_id = ${locationId} group by b.customer_id
    ) s
    where s.last_visit < ${now}::timestamptz - make_interval(days => ${dormantDays}) and not coalesce(s.has_next, false)`;
  return r.n;
}

export type CohortRow = { days: number; cohort: number; eligible: number; returned: number; rate: number | null };

/**
 * 初回来店後 N 日以内の再来店率（コホート）。
 * 対象：初回の来店（この店舗）が対象期間にある顧客。初回から N 日たっていない顧客は「観測中」として母数から除く。
 */
export async function returnCohorts(tx: Tx, locationId: string, range: Range, now = new Date(), windows = [30, 60, 90]): Promise<CohortRow[]> {
  const rows = await tx<{ days: number; cohort: number; eligible: number; returned: number }[]>`
    with v as (
      select customer_id, starts_at from public.bookings
       where location_id = ${locationId} and status = any (${VISIT}::public.booking_status[])
    ), f as (
      select customer_id, min(starts_at) first_at from v group by customer_id
      having min(starts_at) >= ${range.lo} and min(starts_at) < ${range.hi}
    ), s2 as (
      select f.customer_id, f.first_at, (select min(v.starts_at) from v where v.customer_id = f.customer_id and v.starts_at > f.first_at) second_at from f
    )
    select n days, count(*)::int cohort,
           count(*) filter (where first_at + make_interval(days => n) <= ${now})::int eligible,
           count(*) filter (where first_at + make_interval(days => n) <= ${now} and second_at <= first_at + make_interval(days => n))::int returned
      from s2 cross join unnest(${windows}::int[]) n
     group by n order by n`;
  if (rows.length === 0) return windows.map((days) => ({ days, cohort: 0, eligible: 0, returned: 0, rate: null }));
  return rows.map((r) => ({ ...r, rate: ratio(r.returned, r.eligible) }));
}

export type MonthRow = {
  month: string; bookings: number; visits: number; sales: number;
  target: number; noShows: number; noShowRate: number | null;
  visitors: number; newCustomers: number; repeaters: number; repeatRate: number | null;
};

/** 月ごとの推移（今月を含む直近 count か月）。リピート率はその月を対象期間とした値 */
export async function monthly(tx: Tx, locationId: string, timezone: string, count: number, now = new Date(), options: { staffId?: string } = {}): Promise<MonthRow[]> {
  const staffOnly = options.staffId ? tx`and b.staff_id = ${options.staffId}` : tx``;
  const months = monthsEnding(localDate(now, timezone), count);
  const lo = periodRange({ from: `${months[0]}-01`, to: `${months[0]}-01` }, timezone).lo;
  const rows = await tx<{ mon: string; bookings: number; visits: number; sales: number; target: number; no_shows: number }[]>`
    select to_char(b.starts_at at time zone ${timezone}, 'YYYY-MM') mon,
           count(*) filter (where b.status <> all (${CANCELLED}::public.booking_status[]))::int bookings,
           count(*) filter (where b.status = any (${VISIT}::public.booking_status[]))::int visits,
           coalesce(sum(b.price) filter (where b.status = any (${VISIT}::public.booking_status[])), 0)::int sales,
           count(*) filter (where b.starts_at < ${now} and b.status <> 'cancelled_store')::int target,
           count(*) filter (where b.starts_at < ${now} and b.status = 'no_show')::int no_shows
      from public.bookings b
     where b.location_id = ${locationId} and b.starts_at >= ${lo} and b.starts_at < ${now}::timestamptz + interval '62 days' ${staffOnly}
     group by 1`;
  const visitors = await tx<{ mon: string; visitors: number; new_customers: number; repeaters: number }[]>`
    with v as (
      select customer_id, to_char(starts_at at time zone ${timezone}, 'YYYY-MM') mon,
             row_number() over (partition by customer_id order by starts_at) rk
        from public.bookings where location_id = ${locationId} and status = any (${VISIT}::public.booking_status[])
    )
    select mon, count(distinct customer_id)::int visitors,
           count(distinct customer_id) filter (where rk = 1)::int new_customers,
           count(distinct customer_id) filter (where rk >= 2)::int repeaters
      from v where mon >= ${months[0]} group by mon`;
  return months.map((month) => {
    const r = rows.find((x) => x.mon === month);
    const v = visitors.find((x) => x.mon === month);
    return {
      month, bookings: r?.bookings ?? 0, visits: r?.visits ?? 0, sales: r?.sales ?? 0,
      target: r?.target ?? 0, noShows: r?.no_shows ?? 0, noShowRate: ratio(r?.no_shows ?? 0, r?.target ?? 0),
      visitors: v?.visitors ?? 0, newCustomers: v?.new_customers ?? 0, repeaters: v?.repeaters ?? 0,
      repeatRate: ratio(v?.repeaters ?? 0, v?.visitors ?? 0),
    };
  });
}

export type DayRow = { date: string; bookings: number; visits: number; sales: number };

export async function daily(tx: Tx, locationId: string, timezone: string, period: Period): Promise<DayRow[]> {
  const { lo, hi } = periodRange(period, timezone);
  const rows = await tx<{ date: string; bookings: number; visits: number; sales: number }[]>`
    select to_char(b.starts_at at time zone ${timezone}, 'YYYY-MM-DD') date,
           count(*) filter (where b.status <> all (${CANCELLED}::public.booking_status[]))::int bookings,
           count(*) filter (where b.status = any (${VISIT}::public.booking_status[]))::int visits,
           coalesce(sum(b.price) filter (where b.status = any (${VISIT}::public.booking_status[])), 0)::int sales
      from public.bookings b
     where b.location_id = ${locationId} and b.starts_at >= ${lo} and b.starts_at < ${hi}
     group by 1`;
  return datesBetween(period.from, period.to).map((date) => rows.find((r) => r.date === date) ?? { date, bookings: 0, visits: 0, sales: 0 });
}

export type BucketRow = { key: number; bookings: number; visits: number; sales: number; noShow: NoShowSummary };

/** 曜日（0=日曜）または開始時刻（時）ごと */
export async function byTime(tx: Tx, locationId: string, timezone: string, range: Range, unit: "weekday" | "hour", now = new Date()): Promise<BucketRow[]> {
  const cut = cutOf(range, now);
  const key = unit === "weekday" ? tx`extract(dow from b.starts_at at time zone ${timezone})::int` : tx`extract(hour from b.starts_at at time zone ${timezone})::int`;
  const rows = await tx<{ key: number; bookings: number; visits: number; sales: number; target: number; no_shows: number; customer_cancels: number; lost: number }[]>`
    select ${key} key,
           count(*) filter (where b.status <> all (${CANCELLED}::public.booking_status[]))::int bookings,
           count(*) filter (where b.status = any (${VISIT}::public.booking_status[]))::int visits,
           coalesce(sum(b.price) filter (where b.status = any (${VISIT}::public.booking_status[])), 0)::int sales,
           count(*) filter (where b.starts_at < ${cut} and b.status <> 'cancelled_store')::int target,
           count(*) filter (where b.starts_at < ${cut} and b.status = 'no_show')::int no_shows,
           count(*) filter (where b.starts_at < ${cut} and b.status = 'cancelled_customer')::int customer_cancels,
           coalesce(sum(b.price) filter (where b.starts_at < ${cut} and b.status = 'no_show'), 0)::int lost
      from public.bookings b
     where b.location_id = ${locationId} and b.starts_at >= ${range.lo} and b.starts_at < ${range.hi}
     group by 1 order by 1`;
  return rows.map((r) => ({ key: r.key, bookings: r.bookings, visits: r.visits, sales: r.sales, noShow: noShowOf(r) }));
}

export type GroupRow = {
  id: string; name: string; bookings: number; visits: number; sales: number; avgPrice: number | null;
  noShow: NoShowSummary; visitors: number; repeaters: number; repeatRate: number | null;
};

/**
 * サービス別・スタッフ別。
 * リピート率は「そのサービス（スタッフ）を期間内に利用した顧客のうち、期間の終わりまでに同じサービス（同じスタッフ）を2回以上利用した顧客」の割合。
 */
export async function byGroup(tx: Tx, locationId: string, range: Range, group: "service" | "staff", now = new Date()): Promise<GroupRow[]> {
  const cut = cutOf(range, now);
  const col = group === "service" ? tx`b.service_id` : tx`b.staff_id`;
  const names = group === "service"
    ? tx`select id, name, sort_order from public.services where location_id = ${locationId}`
    : tx`select id, name, sort_order from public.staff where location_id = ${locationId}`;
  const rows = await tx<{ id: string; name: string; bookings: number; visits: number; sales: number; target: number; no_shows: number; customer_cancels: number; lost: number; visitors: number; repeaters: number }[]>`
    with g as (${names}),
    agg as (
      select ${col} id,
             count(*) filter (where b.status <> all (${CANCELLED}::public.booking_status[]))::int bookings,
             count(*) filter (where b.status = any (${VISIT}::public.booking_status[]))::int visits,
             coalesce(sum(b.price) filter (where b.status = any (${VISIT}::public.booking_status[])), 0)::int sales,
             count(*) filter (where b.starts_at < ${cut} and b.status <> 'cancelled_store')::int target,
             count(*) filter (where b.starts_at < ${cut} and b.status = 'no_show')::int no_shows,
             count(*) filter (where b.starts_at < ${cut} and b.status = 'cancelled_customer')::int customer_cancels,
             coalesce(sum(b.price) filter (where b.starts_at < ${cut} and b.status = 'no_show'), 0)::int lost
        from public.bookings b
       where b.location_id = ${locationId} and b.starts_at >= ${range.lo} and b.starts_at < ${range.hi} and ${col} is not null
       group by 1
    ),
    per as (
      select ${col} id, b.customer_id, count(*) total, count(*) filter (where b.starts_at >= ${range.lo}) in_period
        from public.bookings b
       where b.location_id = ${locationId} and b.status = any (${VISIT}::public.booking_status[]) and b.starts_at < ${range.hi} and ${col} is not null
       group by 1, 2
    ),
    rep as (
      select id, count(*) filter (where in_period > 0)::int visitors, count(*) filter (where in_period > 0 and total >= 2)::int repeaters
        from per group by id
    )
    select g.id, g.name, coalesce(a.bookings, 0) bookings, coalesce(a.visits, 0) visits, coalesce(a.sales, 0) sales,
           coalesce(a.target, 0) target, coalesce(a.no_shows, 0) no_shows, coalesce(a.customer_cancels, 0) customer_cancels, coalesce(a.lost, 0) lost,
           coalesce(r.visitors, 0) visitors, coalesce(r.repeaters, 0) repeaters
      from g join agg a on a.id = g.id left join rep r on r.id = g.id
     order by a.bookings desc, g.sort_order, g.name`;
  return rows.map((r) => ({
    id: r.id, name: r.name, bookings: r.bookings, visits: r.visits, sales: r.sales, avgPrice: r.visits > 0 ? Math.round(r.sales / r.visits) : null,
    noShow: noShowOf(r), visitors: r.visitors, repeaters: r.repeaters, repeatRate: ratio(r.repeaters, r.visitors),
  }));
}

export type NoShowCustomer = { customerId: string; name: string; noShows: number; target: number; lastNoShow: string };

/** 期間内に無断キャンセルのあった顧客（回数の多い順） */
export async function noShowCustomers(tx: Tx, locationId: string, range: Range, now = new Date(), limit = 10): Promise<NoShowCustomer[]> {
  const cut = cutOf(range, now);
  const rows = await tx<{ customer_id: string; name: string | null; no_shows: number; target: number; last_no_show: Date }[]>`
    select b.customer_id, c.name,
           count(*) filter (where b.status = 'no_show')::int no_shows,
           count(*) filter (where b.status <> 'cancelled_store')::int target,
           max(b.starts_at) filter (where b.status = 'no_show') last_no_show
      from public.bookings b left join public.customers c on c.id = b.customer_id
     where b.location_id = ${locationId} and b.starts_at >= ${range.lo} and b.starts_at < ${cut}
     group by 1, 2 having count(*) filter (where b.status = 'no_show') > 0
     order by 3 desc, 5 desc limit ${limit}`;
  return rows.map((r) => ({ customerId: r.customer_id, name: r.name ?? "（表示できません）", noShows: r.no_shows, target: r.target, lastNoShow: r.last_no_show.toISOString() }));
}

export type Distribution = { label: string; count: number }[];

/** 期間内に来店した顧客の、期間の終わりまでの累計来店回数の分布 */
export async function visitCountDistribution(tx: Tx, locationId: string, range: Range): Promise<Distribution> {
  const rows = await tx<{ bucket: string; n: number }[]>`
    with per as (
      select customer_id, count(*) total, count(*) filter (where starts_at >= ${range.lo}) in_period
        from public.bookings
       where location_id = ${locationId} and status = any (${VISIT}::public.booking_status[]) and starts_at < ${range.hi}
       group by 1
    )
    select case when total >= 10 then '10回以上' when total >= 6 then '6〜9回' else total || '回' end bucket, count(*)::int n
      from per where in_period > 0 group by 1`;
  return ["1回", "2回", "3回", "4回", "5回", "6〜9回", "10回以上"].map((label) => ({ label, count: rows.find((r) => r.bucket === label)?.n ?? 0 }));
}

/** 初回の来店が期間内にある顧客の、2回目の来店までの日数の分布（まだ2回目がない顧客は別に数える） */
export async function daysToReturnDistribution(tx: Tx, locationId: string, range: Range): Promise<Distribution> {
  const rows = await tx<{ bucket: string; n: number }[]>`
    with v as (
      select customer_id, starts_at, row_number() over (partition by customer_id order by starts_at) rk
        from public.bookings where location_id = ${locationId} and status = any (${VISIT}::public.booking_status[])
    ), f as (
      select a.customer_id, a.starts_at first_at, b.starts_at second_at
        from v a left join v b on b.customer_id = a.customer_id and b.rk = 2
       where a.rk = 1 and a.starts_at >= ${range.lo} and a.starts_at < ${range.hi}
    )
    select case
             when second_at is null then 'まだ再来店なし'
             when second_at - first_at <= interval '14 days' then '14日以内'
             when second_at - first_at <= interval '30 days' then '15〜30日'
             when second_at - first_at <= interval '60 days' then '31〜60日'
             when second_at - first_at <= interval '90 days' then '61〜90日'
             else '91日以上' end bucket, count(*)::int n
      from f group by 1`;
  return ["14日以内", "15〜30日", "31〜60日", "61〜90日", "91日以上", "まだ再来店なし"].map((label) => ({ label, count: rows.find((r) => r.bucket === label)?.n ?? 0 }));
}

/** 期間の予約枠の稼働率（今日より後の日は含めない） */
export async function utilization(tx: Tx, locationId: string, timezone: string, period: Period, now = new Date()): Promise<Capacity | null> {
  const today = localDate(now, timezone);
  const to = period.to > today ? today : period.to;
  if (to < period.from) return null;
  const ctx = await loadSchedulingContext(tx, locationId, period.from, to);
  if (!ctx) return null;
  return capacity(ctx, datesBetween(period.from, to));
}

