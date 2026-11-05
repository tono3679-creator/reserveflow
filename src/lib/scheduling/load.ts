import "server-only";
import type { Sql, TransactionSql } from "postgres";
import { addDays, dayRange } from "@/lib/time";
import type { SchedulingContext, ServiceSpec } from "./types";

type Db = Sql | TransactionSql;

/**
 * 空き枠エンジンの入力を DB から読む（店舗・期間ごと）。
 * 管理画面ではログイン利用者の権限（RLS）で、公開予約ではサーバーの接続で呼ぶ。
 * スタッフの立場では他人の予約が RLS で見えないため、空き枠の判定には使わない（DB の排他制約が最後に守る）。
 */
export async function loadSchedulingContext(tx: Db, locationId: string, from: string, to: string): Promise<SchedulingContext | null> {
  const [settings] = await tx<{
    timezone: string; slot_interval_minutes: number; min_lead_minutes: number; max_advance_days: number;
    staff_selection: SchedulingContext["staffSelection"];
  }[]>`
    select l.timezone, t.slot_interval_minutes, t.min_lead_minutes, t.max_advance_days, t.staff_selection
      from public.locations l join public.tenant_settings t on t.location_id = l.id where l.id = ${locationId}`;
  if (!settings) return null;
  const tz = settings.timezone;
  const rangeStart = dayRange(addDays(from, -1), tz).start;
  const rangeEnd = dayRange(addDays(to, 1), tz).end;

  const [hours, exceptions, staff, schedules, timeOff, resources, bookings] = await Promise.all([
    tx<{ weekday: number; opens: string; closes: string }[]>`
      select weekday, to_char(opens_at, 'HH24:MI') opens, to_char(closes_at, 'HH24:MI') closes
        from public.business_hours where location_id = ${locationId}`,
    tx<{ date: string; is_closed: boolean; opens: string | null; closes: string | null }[]>`
      select date, is_closed, to_char(opens_at, 'HH24:MI') opens, to_char(closes_at, 'HH24:MI') closes
        from public.business_hour_exceptions where location_id = ${locationId} and date between ${from} and ${to}`,
    tx<{ id: string; name: string }[]>`
      select id, name from public.staff where location_id = ${locationId} and is_active order by sort_order, name`,
    tx<{ staff_id: string; weekday: number; start: string; end: string; break_start: string | null; break_end: string | null }[]>`
      select ss.staff_id, ss.weekday, to_char(ss.starts_at, 'HH24:MI') start, to_char(ss.ends_at, 'HH24:MI') "end",
             to_char(ss.break_starts_at, 'HH24:MI') break_start, to_char(ss.break_ends_at, 'HH24:MI') break_end
        from public.staff_schedules ss join public.staff s on s.id = ss.staff_id where s.location_id = ${locationId}`,
    tx<{ staff_id: string; date: string; kind: "day_off" | "custom_hours"; start: string | null; end: string | null }[]>`
      select t.staff_id, t.date, t.kind, to_char(t.starts_at, 'HH24:MI') start, to_char(t.ends_at, 'HH24:MI') "end"
        from public.staff_time_off t join public.staff s on s.id = t.staff_id
       where s.location_id = ${locationId} and t.date between ${from} and ${to}`,
    tx<{ id: string; name: string }[]>`
      select id, name from public.resources where location_id = ${locationId} and is_active order by sort_order, name`,
    tx<{ id: string; staff_id: string | null; lo: Date; hi: Date; resource_ids: string[] | null }[]>`
      select b.id, b.staff_id, lower(b.occupied) lo, upper(b.occupied) hi,
             array(select br.resource_id from public.booking_resources br where br.booking_id = b.id and br.is_active) resource_ids
        from public.bookings b
       where b.location_id = ${locationId} and public.booking_blocks_slot(b.status)
         and b.occupied && tstzrange(${rangeStart}, ${rangeEnd})`,
  ]);

  return {
    timezone: tz,
    slotIntervalMinutes: settings.slot_interval_minutes,
    minLeadMinutes: settings.min_lead_minutes,
    maxAdvanceDays: settings.max_advance_days,
    staffSelection: settings.staff_selection,
    businessHours: hours,
    exceptions: exceptions.map((e) => ({ date: e.date, isClosed: e.is_closed, opens: e.opens, closes: e.closes })),
    staff: staff.map((s) => ({
      id: s.id,
      name: s.name,
      schedules: schedules.filter((x) => x.staff_id === s.id).map((x) => ({ weekday: x.weekday, start: x.start, end: x.end, breakStart: x.break_start, breakEnd: x.break_end })),
      timeOff: timeOff.filter((x) => x.staff_id === s.id).map((x) => ({ date: x.date, kind: x.kind, start: x.start, end: x.end })),
    })),
    resources,
    bookings: bookings.map((b) => ({ id: b.id, staffId: b.staff_id, resourceIds: b.resource_ids ?? [], start: b.lo.getTime(), end: b.hi.getTime() })),
  };
}

/** 店舗のサービス（空き枠エンジンの形）。公開予約では公開中のものだけ */
export async function loadServiceSpecs(tx: Db, locationId: string, options: { publicOnly?: boolean } = {}): Promise<(ServiceSpec & { price: number; category: string | null; description: string | null; isPublic: boolean })[]> {
  const rows = await tx<{
    id: string; name: string; duration_minutes: number; buffer_before_minutes: number; buffer_after_minutes: number;
    price: number; category: string | null; description: string | null; is_public: boolean; staff_ids: string[]; resource_ids: string[];
  }[]>`
    select s.id, s.name, s.duration_minutes, s.buffer_before_minutes, s.buffer_after_minutes, s.price, s.category, s.description, s.is_public,
           array(select ss.staff_id from public.service_staff ss join public.staff st on st.id = ss.staff_id
                  where ss.service_id = s.id and st.is_active order by st.sort_order) staff_ids,
           array(select sr.resource_id from public.service_resources sr join public.resources r on r.id = sr.resource_id
                  where sr.service_id = s.id and r.is_active order by r.sort_order) resource_ids
      from public.services s
     where s.location_id = ${locationId} and s.is_active and (${options.publicOnly ?? false} = false or s.is_public)
     order by s.sort_order, s.name`;
  return rows.map((r) => ({
    id: r.id, name: r.name, durationMinutes: r.duration_minutes, bufferBeforeMinutes: r.buffer_before_minutes,
    bufferAfterMinutes: r.buffer_after_minutes, staffIds: r.staff_ids, resourceIds: r.resource_ids,
    price: r.price, category: r.category, description: r.description, isPublic: r.is_public,
  }));
}
