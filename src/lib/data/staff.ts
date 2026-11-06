import "server-only";
import type { Tx } from "@/lib/db";
import { capacity } from "@/lib/analytics/capacity";
import { byGroup } from "@/lib/analytics/metrics";
import { periodRange } from "@/lib/analytics/period";
import { datesBetween } from "@/lib/scheduling/engine";
import { loadSchedulingContext } from "@/lib/scheduling/load";
import { addDays, localDate } from "@/lib/time";

export const STATS_DAYS = 30;

export type StaffStats = {
  bookings: number;      // 期間内の担当予約（キャンセルを除く）
  visits: number;        // 来店済み・サービス完了
  noShows: number;
  revenue: number;       // 来店した予約の料金
  avgPrice: number | null;
  bookedMinutes: number; // 勤務時間のうち予約で埋まった時間（前後の準備時間を含む）
  workingMinutes: number;
  utilization: number | null; // bookedMinutes ÷ workingMinutes
  noShowRate: number | null;  // 無断キャンセル ÷ 母数（店舗キャンセルを除く予約。分析画面と同じ定義）
  noShowTarget: number;
  repeatRate: number | null;  // 担当した顧客のうち、同じスタッフを累計2回以上利用した顧客の割合
  visitors: number;
  repeaters: number;
  upcoming: number;      // 今日から7日間の予約
};

export type StaffRow = {
  id: string; name: string; title: string | null; email: string | null; color: string; isActive: boolean; memberId: string | null;
  serviceIds: string[]; stats: StaffStats | null;
};

/**
 * スタッフの一覧と直近30日（昨日まで）の実績。計算は分析画面（src/lib/analytics）と同じ。
 * 稼働率 = 予約で埋まった時間 ÷ 勤務時間（基本勤務と休暇・勤務変更から、休憩を除いて計算）。
 */
export async function listStaff(tx: Tx, locationId: string, timezone: string, now = new Date()): Promise<StaffRow[]> {
  const today = localDate(now, timezone);
  const period = { from: addDays(today, -STATS_DAYS), to: addDays(today, -1) };
  const range = periodRange(period, timezone);
  const [staff, scheduling, groups, upcoming] = await Promise.all([
    tx<{ id: string; name: string; title: string | null; email: string | null; color: string; is_active: boolean; member_id: string | null; service_ids: string[] }[]>`
      select s.id, s.name, s.title, s.email, s.color, s.is_active, s.member_id,
             array(select ss.service_id from public.service_staff ss where ss.staff_id = s.id) service_ids
        from public.staff s where s.location_id = ${locationId} order by s.is_active desc, s.sort_order, s.name`,
    loadSchedulingContext(tx, locationId, period.from, period.to),
    byGroup(tx, locationId, range, "staff", now),
    tx<{ staff_id: string; n: number }[]>`
      select b.staff_id, count(*)::int n from public.bookings b
       where b.location_id = ${locationId} and b.staff_id is not null and public.booking_blocks_slot(b.status)
         and b.starts_at >= ${range.hi} and b.starts_at < ${range.hi}::timestamptz + interval '7 days'
       group by 1`,
  ]);
  const cap = scheduling ? capacity(scheduling, datesBetween(period.from, period.to)) : null;
  return staff.map((s) => {
    const g = groups.find((x) => x.id === s.id);
    const c = cap?.byStaff.find((x) => x.staffId === s.id);
    const stats: StaffStats | null = s.is_active ? {
      bookings: g?.bookings ?? 0, visits: g?.visits ?? 0, noShows: g?.noShow.noShows ?? 0, revenue: g?.sales ?? 0, avgPrice: g?.avgPrice ?? null,
      bookedMinutes: Math.round(c?.bookedMinutes ?? 0), workingMinutes: Math.round(c?.availableMinutes ?? 0), utilization: c?.rate ?? null,
      noShowRate: g?.noShow.noShowRate ?? null, noShowTarget: g?.noShow.target ?? 0,
      repeatRate: g?.repeatRate ?? null, visitors: g?.visitors ?? 0, repeaters: g?.repeaters ?? 0,
      upcoming: upcoming.find((x) => x.staff_id === s.id)?.n ?? 0,
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
