"use server";
import { z } from "zod";
import { withAuth } from "@/lib/auth";
import { can } from "@/lib/auth/roles";
import { businessWindows, staffDay } from "@/lib/scheduling/engine";
import { loadSchedulingContext } from "@/lib/scheduling/load";
import { localTime } from "@/lib/time";
import { getCalendarBookings, type CalendarBooking } from "@/lib/data/bookings";
import { runAction, type ActionResult } from "./result";

const rangeSchema = z.object({
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  includeCancelled: z.boolean(),
}).refine((v) => new Date(v.end).getTime() - new Date(v.start).getTime() <= 62 * 86_400_000, "期間が長すぎます");

/** カレンダーの表示期間の予約（表示を切り替えるたびにブラウザから呼ぶ） */
export async function fetchCalendarBookings(input: unknown): Promise<ActionResult<CalendarBooking[]>> {
  return runAction(async () => {
    const v = rangeSchema.parse(input);
    return withAuth(undefined, (tx, ctx) => getCalendarBookings(tx, ctx.location.id, new Date(v.start), new Date(v.end), v.includeCancelled));
  });
}

export type StaffDayInfo = {
  date: string;
  open: { start: string; end: string }[];
  staff: { id: string; name: string; color: string; title: string | null; working: { start: string; end: string }[]; breaks: { start: string; end: string }[]; dayOff: boolean }[];
};

/** スタッフ別表示：その日の営業時間・各スタッフの勤務と休憩（時刻は店舗の現地時刻 'HH:MM'） */
export async function fetchStaffDay(dateInput: string): Promise<ActionResult<StaffDayInfo>> {
  return runAction(async () => {
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(dateInput);
    return withAuth(undefined, async (tx, ctx) => {
      const scheduling = await loadSchedulingContext(tx, ctx.location.id, date, date);
      if (!scheduling) throw new Error("店舗の設定が見つかりません");
      const tz = scheduling.timezone;
      const hhmm = (ms: number) => localTime(new Date(ms), tz);
      const staff = await tx<{ id: string; color: string; title: string | null }[]>`
        select id, color, title from public.staff where location_id = ${ctx.location.id} and is_active order by sort_order, name`;
      // スタッフの立場では自分だけを表示する
      const visible = can(ctx.role, "bookings.viewAll") ? scheduling.staff : scheduling.staff.filter((s) => ctx.staffIds.includes(s.id));
      return {
        date,
        open: businessWindows(scheduling, date).map((w) => ({ start: hhmm(w.start), end: hhmm(w.end) })),
        staff: visible.map((s) => {
          const day = staffDay(scheduling, s, date);
          const meta = staff.find((x) => x.id === s.id);
          return {
            id: s.id, name: s.name, color: meta?.color ?? "#3b82f6", title: meta?.title ?? null, dayOff: day.dayOff,
            working: day.windows.map((w) => ({ start: hhmm(w.start), end: hhmm(w.end) })),
            breaks: day.breaks.map((w) => ({ start: hhmm(w.start), end: hhmm(w.end) })),
          };
        }),
      };
    });
  });
}
