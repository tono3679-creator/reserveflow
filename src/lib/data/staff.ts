import "server-only";
import type { Tx } from "@/lib/db";
import { datesBetween, staffDay } from "@/lib/scheduling/engine";
import { loadSchedulingContext } from "@/lib/scheduling/load";
import { addDays, localDate } from "@/lib/time";

export const STATS_DAYS = 30;

export type StaffStats = {
  bookings: number;      // 期間内の予約（キャンセルを含む）
  visits: number;        // 来店済み・サービス完了
  noShows: number;
  revenue: number;       // 来店済み・サービス完了の料金
  bookedMinutes: number; // 枠を占有した予約の時間（準備時間を除く）
  workingMinutes: number;
  utilization: number | null; // bookedMinutes ÷ workingMinutes
  noShowRate: number | null;  // 無断キャンセル ÷（来店 + 無断キャンセル）
  upcoming: number;      // 今日から7日間の予約
};

export type StaffRow = {
  id: string; name: string; title: string | null; email: string | null; color: string; isActive: boolean; memberId: string | null;
  serviceIds: string[]; stats: StaffStats | null;
};

/**
 * スタッフの一覧と直近30日の実績。
 * 稼働率 = 予約で埋まった時間 ÷ 勤務時間（基本勤務と休暇・勤務変更から、休憩を除いて計算）。
 */
export async function listStaff(tx: Tx, locationId: string, timezone: string, now = new Date()): Promise<StaffRow[]> {
  const today = localDate(now, timezone);
  const from = addDays(today, -STATS_DAYS);
  const to = addDays(today, -1);
  const [staff, scheduling, agg] = await Promise.all([
    tx<{ id: string; name: string; title: string | null; email: string | null; color: string; is_active: boolean; member_id: string | null; service_ids: string[] }[]>`
      select s.id, s.name, s.title, s.email, s.color, s.is_active, s.member_id,
             array(select ss.service_id from public.service_staff ss where ss.staff_id = s.id) service_ids
        from public.staff s where s.location_id = ${locationId} order by s.is_active desc, s.sort_order, s.name`,
    loadSchedulingContext(tx, locationId, from, to),
    tx<{ staff_id: string; bookings: number; visits: number; no_shows: number; revenue: number; booked_minutes: number; upcoming: number }[]>`
      select b.staff_id,
             count(*) filter (where b.starts_at >= p.lo and b.starts_at < p.hi)::int bookings,
             count(*) filter (where b.starts_at >= p.lo and b.starts_at < p.hi and b.status in ('checked_in', 'completed'))::int visits,
             count(*) filter (where b.starts_at >= p.lo and b.starts_at < p.hi and b.status = 'no_show')::int no_shows,
             coalesce(sum(b.price) filter (where b.starts_at >= p.lo and b.starts_at < p.hi and b.status in ('checked_in', 'completed')), 0)::int revenue,
             coalesce(sum(extract(epoch from b.ends_at - b.starts_at) / 60) filter (where b.starts_at >= p.lo and b.starts_at < p.hi and public.booking_blocks_slot(b.status)), 0)::int booked_minutes,
             count(*) filter (where b.starts_at >= p.hi and b.starts_at < p.hi + interval '7 days' and public.booking_blocks_slot(b.status))::int upcoming
        from public.bookings b
        join public.locations l on l.id = b.location_id
        cross join lateral (select (${from}::date)::timestamp at time zone l.timezone lo, (${today}::date)::timestamp at time zone l.timezone hi) p
       where b.location_id = ${locationId} and b.staff_id is not null
       group by b.staff_id`,
  ]);
  const days = datesBetween(from, to);
  return staff.map((s) => {
    const a = agg.find((x) => x.staff_id === s.id);
    const info = scheduling?.staff.find((x) => x.id === s.id);
    let workingMinutes = 0;
    if (scheduling && info) {
      for (const d of days) for (const w of staffDay(scheduling, info, d).windows) workingMinutes += (w.end - w.start) / 60_000;
    }
    const stats: StaffStats | null = s.is_active ? {
      bookings: a?.bookings ?? 0, visits: a?.visits ?? 0, noShows: a?.no_shows ?? 0, revenue: a?.revenue ?? 0,
      bookedMinutes: a?.booked_minutes ?? 0, workingMinutes, upcoming: a?.upcoming ?? 0,
      utilization: workingMinutes > 0 ? (a?.booked_minutes ?? 0) / workingMinutes : null,
      noShowRate: (a?.visits ?? 0) + (a?.no_shows ?? 0) > 0 ? (a?.no_shows ?? 0) / ((a?.visits ?? 0) + (a?.no_shows ?? 0)) : null,
    } : null;
    return {
      id: s.id, name: s.name, title: s.title, email: s.email, color: s.color, isActive: s.is_active, memberId: s.member_id,
      serviceIds: s.service_ids, stats,
    };
  });
}

export type StaffDetail = StaffRow & {
  schedules: { weekday: number; start: string; end: string; breakStart: string | null; breakEnd: string | null }[];
  timeOff: { id: string; date: string; kind: "day_off" | "custom_hours"; start: string | null; end: string | null; reason: string | null; bookings: number }[];
  memberName: string | null;
};

export async function getStaffDetail(tx: Tx, locationId: string, timezone: string, staffId: string, now = new Date()): Promise<StaffDetail | null> {
  const rows = await listStaff(tx, locationId, timezone, now);
  const base = rows.find((r) => r.id === staffId);
  if (!base) return null;
  const today = localDate(now, timezone);
  const [schedules, timeOff, [member]] = await Promise.all([
    tx<{ weekday: number; start: string; end: string; break_start: string | null; break_end: string | null }[]>`
      select weekday, to_char(starts_at, 'HH24:MI') start, to_char(ends_at, 'HH24:MI') "end",
             to_char(break_starts_at, 'HH24:MI') break_start, to_char(break_ends_at, 'HH24:MI') break_end
        from public.staff_schedules where staff_id = ${staffId} order by weekday`,
    tx<{ id: string; date: string; kind: "day_off" | "custom_hours"; start: string | null; end: string | null; reason: string | null; bookings: number }[]>`
      select t.id, to_char(t.date, 'YYYY-MM-DD') date, t.kind, to_char(t.starts_at, 'HH24:MI') start, to_char(t.ends_at, 'HH24:MI') "end", t.reason,
             (select count(*)::int from public.bookings b
               where b.staff_id = t.staff_id and public.booking_blocks_slot(b.status)
                 and (b.starts_at at time zone ${timezone})::date = t.date) bookings
        from public.staff_time_off t where t.staff_id = ${staffId} and t.date >= ${today}::date order by t.date`,
    tx<{ display_name: string }[]>`select display_name from public.organization_members where id = ${base.memberId}`,
  ]);
  return {
    ...base,
    schedules: schedules.map((s) => ({ weekday: s.weekday, start: s.start, end: s.end, breakStart: s.break_start, breakEnd: s.break_end })),
    timeOff,
    memberName: member?.display_name ?? null,
  };
}
