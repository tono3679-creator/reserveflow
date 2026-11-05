import "server-only";
import type { Tx } from "@/lib/db";
import type { BookingStatus } from "@/lib/domain/booking";
import { dayRange, localDate } from "@/lib/time";

export type TodayBooking = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  customerName: string;
  serviceName: string;
  staffName: string | null;
  resourceName: string | null;
  status: BookingStatus;
  price: number;
};

/**
 * 本日（店舗のタイムゾーン）の予約。RLS により staff には自分の担当分だけが返る。
 * 顧客名は RLS で見えない顧客の場合は表示しない（staff が担当外の顧客を見ることはない）。
 */
export async function getTodayBookings(tx: Tx, locationId: string, timezone: string, now = new Date()): Promise<TodayBooking[]> {
  const { start, end } = dayRange(localDate(now, timezone), timezone);
  const rows = await tx<{
    id: string; starts_at: Date; ends_at: Date; customer_name: string | null; service_name: string; staff_name: string | null;
    resource_name: string | null; status: BookingStatus; price: number;
  }[]>`
    select b.id, b.starts_at, b.ends_at, c.name customer_name, s.name service_name, st.name staff_name,
           (select string_agg(r.name, '、') from public.booking_resources br join public.resources r on r.id = br.resource_id
             where br.booking_id = b.id) resource_name,
           b.status, b.price
      from public.bookings b
      join public.services s on s.id = b.service_id
      left join public.customers c on c.id = b.customer_id
      left join public.staff st on st.id = b.staff_id
     where b.location_id = ${locationId} and b.starts_at >= ${start} and b.starts_at < ${end}
     order by b.starts_at, st.sort_order nulls last`;
  return rows.map((r) => ({
    id: r.id, startsAt: r.starts_at, endsAt: r.ends_at, customerName: r.customer_name ?? "（表示できません）",
    serviceName: r.service_name, staffName: r.staff_name, resourceName: r.resource_name, status: r.status, price: r.price,
  }));
}
