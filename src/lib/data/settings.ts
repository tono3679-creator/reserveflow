import "server-only";
import type { Tx } from "@/lib/db";

export type LocationSettings = {
  location: { id: string; name: string; slug: string; industry: string; phone: string | null; email: string | null; address: string | null; logoUrl: string | null; timezone: string };
  rules: {
    publicBookingEnabled: boolean; staffSelection: "required" | "optional" | "none"; slotIntervalMinutes: 10 | 15 | 20 | 30 | 60;
    minLeadMinutes: number; maxAdvanceDays: number; cancelDeadlineHours: number; cancellationPolicy: string;
    remindDayBefore: boolean; remindSameDay: boolean;
  };
  hours: { weekday: number; opensAt: string; closesAt: string }[];
};

export async function getLocationSettings(tx: Tx, locationId: string): Promise<LocationSettings | null> {
  const [row] = await tx<{
    id: string; name: string; slug: string; industry: string; phone: string | null; email: string | null; address: string | null;
    logo_url: string | null; timezone: string; public_booking_enabled: boolean; staff_selection: "required" | "optional" | "none";
    slot_interval_minutes: 10 | 15 | 20 | 30 | 60; min_lead_minutes: number; max_advance_days: number; cancel_deadline_hours: number;
    cancellation_policy: string; remind_day_before: boolean; remind_same_day: boolean;
  }[]>`
    select l.id, l.name, l.slug, l.industry, l.phone, l.email, l.address, l.logo_url, l.timezone,
           t.public_booking_enabled, t.staff_selection, t.slot_interval_minutes, t.min_lead_minutes, t.max_advance_days,
           t.cancel_deadline_hours, t.cancellation_policy, t.remind_day_before, t.remind_same_day
      from public.locations l join public.tenant_settings t on t.location_id = l.id
     where l.id = ${locationId}`;
  if (!row) return null;
  const hours = await tx<{ weekday: number; opens_at: string; closes_at: string }[]>`
    select weekday, to_char(opens_at, 'HH24:MI') opens_at, to_char(closes_at, 'HH24:MI') closes_at
      from public.business_hours where location_id = ${locationId} order by weekday, opens_at`;
  return {
    location: { id: row.id, name: row.name, slug: row.slug, industry: row.industry, phone: row.phone, email: row.email, address: row.address, logoUrl: row.logo_url, timezone: row.timezone },
    rules: {
      publicBookingEnabled: row.public_booking_enabled, staffSelection: row.staff_selection, slotIntervalMinutes: row.slot_interval_minutes,
      minLeadMinutes: row.min_lead_minutes, maxAdvanceDays: row.max_advance_days, cancelDeadlineHours: row.cancel_deadline_hours,
      cancellationPolicy: row.cancellation_policy, remindDayBefore: row.remind_day_before, remindSameDay: row.remind_same_day,
    },
    hours: hours.map((h) => ({ weekday: h.weekday, opensAt: h.opens_at, closesAt: h.closes_at })),
  };
}
