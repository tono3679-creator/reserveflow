import "server-only";
import type { Tx } from "@/lib/db";
import type { Segment, SegmentRules } from "@/lib/domain/customer-segment";
import type { BookingStatus } from "@/lib/domain/booking";

export async function getSegmentRules(tx: Tx, locationId: string): Promise<SegmentRules> {
  const [r] = await tx<{ segment_repeat_min_visits: number; segment_vip_min_visits: number; segment_vip_min_spend: number; segment_dormant_days: number }[]>`
    select segment_repeat_min_visits, segment_vip_min_visits, segment_vip_min_spend, segment_dormant_days from public.tenant_settings where location_id = ${locationId}`;
  return {
    repeatMinVisits: r?.segment_repeat_min_visits ?? 2, vipMinVisits: r?.segment_vip_min_visits ?? 6,
    vipMinSpend: r?.segment_vip_min_spend ?? 50000, dormantDays: r?.segment_dormant_days ?? 90,
  };
}

/**
 * 顧客ごとの集計（この店舗の予約から）とセグメント。RLS により staff は担当した顧客・担当した予約だけで集計される。
 * 来店 = 開始時刻を過ぎた「来店済み」「サービス完了」の予約。
 */
function statsQuery(tx: Tx, locationId: string, rules: SegmentRules, now: Date) {
  return tx`
    select c.id, c.name, c.name_kana, c.phone, c.email, c.preferred_staff_id, c.created_at, c.source,
           coalesce(s.visits, 0)::int visits, coalesce(s.spend, 0)::int spend, s.first_visit, s.last_visit, s.next_booking,
           coalesce(s.no_shows, 0)::int no_shows, coalesce(s.cancellations, 0)::int cancellations, coalesce(s.total, 0)::int total,
           case
             when coalesce(s.visits, 0) = 0 then 'prospect'
             when s.last_visit < ${now}::timestamptz - make_interval(days => ${rules.dormantDays}) and s.next_booking is null then 'dormant'
             when s.visits >= ${rules.vipMinVisits} and s.spend >= ${rules.vipMinSpend} then 'vip'
             when s.visits >= ${rules.repeatMinVisits} then 'repeat'
             else 'new'
           end segment
      from public.customers c
      left join (
        select b.customer_id,
               count(*) filter (where b.status in ('checked_in', 'completed') and b.starts_at <= ${now}) visits,
               sum(b.price) filter (where b.status in ('checked_in', 'completed') and b.starts_at <= ${now}) spend,
               min(b.starts_at) filter (where b.status in ('checked_in', 'completed') and b.starts_at <= ${now}) first_visit,
               max(b.starts_at) filter (where b.status in ('checked_in', 'completed') and b.starts_at <= ${now}) last_visit,
               min(b.starts_at) filter (where b.status = 'confirmed' and b.starts_at > ${now}) next_booking,
               count(*) filter (where b.status = 'no_show') no_shows,
               count(*) filter (where b.status in ('cancelled_customer', 'cancelled_store')) cancellations,
               count(*) total
          from public.bookings b where b.location_id = ${locationId}
         group by b.customer_id
      ) s on s.customer_id = c.id`;
}

type StatsRow = {
  id: string; name: string; name_kana: string | null; phone: string | null; email: string | null; preferred_staff_id: string | null;
  created_at: Date; source: string; visits: number; spend: number; first_visit: Date | null; last_visit: Date | null; next_booking: Date | null;
  no_shows: number; cancellations: number; total: number; segment: Segment;
};

export type CustomerSummary = {
  id: string; name: string; nameKana: string | null; phone: string | null; email: string | null; preferredStaffId: string | null;
  createdAt: string; visits: number; spend: number; firstVisit: string | null; lastVisit: string | null; nextBooking: string | null;
  noShows: number; cancellations: number; totalBookings: number; segment: Segment;
};

function toSummary(r: StatsRow): CustomerSummary {
  return {
    id: r.id, name: r.name, nameKana: r.name_kana, phone: r.phone, email: r.email, preferredStaffId: r.preferred_staff_id,
    createdAt: r.created_at.toISOString(), visits: r.visits, spend: r.spend, firstVisit: r.first_visit?.toISOString() ?? null,
    lastVisit: r.last_visit?.toISOString() ?? null, nextBooking: r.next_booking?.toISOString() ?? null,
    noShows: r.no_shows, cancellations: r.cancellations, totalBookings: r.total, segment: r.segment,
  };
}

export type CustomerListFilters = {
  q?: string;
  segment?: Segment;
  sort: "name" | "last_visit" | "visits" | "spend" | "created_at";
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
};

export async function listCustomers(
  tx: Tx, organizationId: string, locationId: string, rules: SegmentRules, f: CustomerListFilters, now = new Date(),
): Promise<{ rows: CustomerSummary[]; total: number; segmentCounts: Record<Segment, number> }> {
  const q = f.q?.trim() ? `%${f.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const base = statsQuery(tx, locationId, rules, now);
  const order = {
    name: tx`coalesce(name_kana, name)`,
    last_visit: tx`last_visit`,
    visits: tx`visits`,
    spend: tx`spend`,
    created_at: tx`created_at`,
  }[f.sort];
  const search = q ? tx`and (name ilike ${q} or name_kana ilike ${q} or phone ilike ${q} or email ilike ${q})` : tx``;
  const [rows, counts] = await Promise.all([
    tx<(StatsRow & { full_count: number })[]>`
      with x as (${base} where c.organization_id = ${organizationId})
      select *, count(*) over ()::int full_count from x
       where true ${search} ${f.segment ? tx`and segment = ${f.segment}` : tx``}
       order by ${order} ${f.dir === "asc" ? tx`asc nulls first` : tx`desc nulls last`}, id
       limit ${f.pageSize} offset ${(f.page - 1) * f.pageSize}`,
    tx<{ segment: Segment; n: number }[]>`
      with x as (${base} where c.organization_id = ${organizationId})
      select segment, count(*)::int n from x where true ${search} group by segment`,
  ]);
  const segmentCounts = { vip: 0, repeat: 0, new: 0, dormant: 0, prospect: 0 } as Record<Segment, number>;
  for (const c of counts) segmentCounts[c.segment] = c.n;
  // 指定したページに行がないときも件数は数え直す
  let total = rows[0]?.full_count ?? 0;
  if (rows.length === 0 && f.page > 1) total = f.segment ? segmentCounts[f.segment] : Object.values(segmentCounts).reduce((a, b) => a + b, 0);
  return { rows: rows.map(toSummary), total, segmentCounts };
}

export type CustomerDetail = CustomerSummary & {
  preferredStaffName: string | null;
  notes: { id: string; body: string; createdAt: string; author: string | null; mine: boolean }[];
  bookings: { id: string; startsAt: string; endsAt: string; status: BookingStatus; serviceName: string; staffName: string | null; price: number }[];
  favoriteService: string | null;
  averageIntervalDays: number | null;
};

export async function getCustomerDetail(tx: Tx, organizationId: string, locationId: string, customerId: string, rules: SegmentRules, memberId: string | null, now = new Date()): Promise<CustomerDetail | null> {
  const [row] = await tx<StatsRow[]>`with x as (${statsQuery(tx, locationId, rules, now)} where c.organization_id = ${organizationId} and c.id = ${customerId}) select * from x`;
  if (!row) return null;
  const [notes, bookings, [staff]] = await Promise.all([
    tx<{ id: string; body: string; created_at: Date; author: string | null; author_member_id: string | null }[]>`
      select n.id, n.body, n.created_at, n.author_member_id, m.display_name author
        from public.customer_notes n left join public.organization_members m on m.id = n.author_member_id
       where n.customer_id = ${customerId} order by n.created_at desc`,
    tx<{ id: string; starts_at: Date; ends_at: Date; status: BookingStatus; service_name: string; staff_name: string | null; price: number }[]>`
      select b.id, b.starts_at, b.ends_at, b.status, s.name service_name, st.name staff_name, b.price
        from public.bookings b join public.services s on s.id = b.service_id left join public.staff st on st.id = b.staff_id
       where b.customer_id = ${customerId} and b.location_id = ${locationId}
       order by b.starts_at desc limit 200`,
    tx<{ name: string }[]>`select name from public.staff where id = ${row.preferred_staff_id}`,
  ]);
  const visits = bookings.filter((b) => (b.status === "completed" || b.status === "checked_in") && b.starts_at <= now);
  const counts = new Map<string, number>();
  for (const b of visits) counts.set(b.service_name, (counts.get(b.service_name) ?? 0) + 1);
  const favorite = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const times = visits.map((b) => b.starts_at.getTime()).sort((a, b) => a - b);
  const averageIntervalDays = times.length >= 2 ? Math.round((times[times.length - 1] - times[0]) / (times.length - 1) / 86_400_000) : null;
  return {
    ...toSummary(row),
    preferredStaffName: staff?.name ?? null,
    notes: notes.map((n) => ({ id: n.id, body: n.body, createdAt: n.created_at.toISOString(), author: n.author, mine: !!memberId && n.author_member_id === memberId })),
    bookings: bookings.map((b) => ({ id: b.id, startsAt: b.starts_at.toISOString(), endsAt: b.ends_at.toISOString(), status: b.status, serviceName: b.service_name, staffName: b.staff_name, price: b.price })),
    favoriteService: favorite,
    averageIntervalDays,
  };
}
