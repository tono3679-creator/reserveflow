import "server-only";
import type { Tx } from "@/lib/db";
import type { BookingStatus } from "@/lib/domain/booking";

export type BookingOptions = {
  staffSelection: "required" | "optional" | "none";
  services: { id: string; name: string; category: string | null; price: number; durationMinutes: number; staffIds: string[]; needsResource: boolean }[];
  staff: { id: string; name: string; title: string | null; color: string }[];
};

/** 予約フォームの選択肢（店舗の有効なサービス・スタッフ） */
export async function getBookingOptions(tx: Tx, locationId: string): Promise<BookingOptions> {
  const [[settings], services, staff] = await Promise.all([
    tx<{ staff_selection: BookingOptions["staffSelection"] }[]>`select staff_selection from public.tenant_settings where location_id = ${locationId}`,
    tx<{ id: string; name: string; category: string | null; price: number; duration_minutes: number; staff_ids: string[]; needs_resource: boolean }[]>`
      select s.id, s.name, s.category, s.price, s.duration_minutes,
             array(select ss.staff_id from public.service_staff ss join public.staff st on st.id = ss.staff_id where ss.service_id = s.id and st.is_active) staff_ids,
             exists (select 1 from public.service_resources sr where sr.service_id = s.id) needs_resource
        from public.services s where s.location_id = ${locationId} and s.is_active order by s.sort_order, s.name`,
    tx<{ id: string; name: string; title: string | null; color: string }[]>`
      select id, name, title, color from public.staff where location_id = ${locationId} and is_active order by sort_order, name`,
  ]);
  return {
    staffSelection: settings?.staff_selection ?? "optional",
    services: services.map((s) => ({ id: s.id, name: s.name, category: s.category, price: s.price, durationMinutes: s.duration_minutes, staffIds: s.staff_ids, needsResource: s.needs_resource })),
    staff,
  };
}

export type CalendarBooking = {
  id: string;
  version: number;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  customerId: string;
  customerName: string;
  serviceId: string;
  serviceName: string;
  staffId: string | null;
  staffName: string | null;
  color: string;
  resourceNames: string | null;
  price: number;
  notes: string | null;
};

/** カレンダーに表示する予約（期間と重なるもの。RLS により staff は自分の担当だけ） */
export async function getCalendarBookings(tx: Tx, locationId: string, start: Date, end: Date, includeCancelled: boolean): Promise<CalendarBooking[]> {
  const rows = await tx<{
    id: string; version: number; starts_at: Date; ends_at: Date; status: BookingStatus; customer_id: string; customer_name: string | null;
    service_id: string; service_name: string; staff_id: string | null; staff_name: string | null; color: string; resource_names: string | null;
    price: number; notes: string | null;
  }[]>`
    select b.id, b.version, b.starts_at, b.ends_at, b.status, b.customer_id, c.name customer_name, b.service_id, s.name service_name,
           b.staff_id, st.name staff_name, coalesce(st.color, s.color) color, b.price, b.notes,
           (select string_agg(r.name, '、') from public.booking_resources br join public.resources r on r.id = br.resource_id where br.booking_id = b.id) resource_names
      from public.bookings b
      join public.services s on s.id = b.service_id
      left join public.customers c on c.id = b.customer_id
      left join public.staff st on st.id = b.staff_id
     where b.location_id = ${locationId} and b.starts_at < ${end} and b.ends_at > ${start}
       and (${includeCancelled} or public.booking_blocks_slot(b.status))
     order by b.starts_at
     limit 3000`;
  return rows.map((r) => ({
    id: r.id, version: r.version, startsAt: r.starts_at.toISOString(), endsAt: r.ends_at.toISOString(), status: r.status,
    customerId: r.customer_id, customerName: r.customer_name ?? "（表示できません）", serviceId: r.service_id, serviceName: r.service_name,
    staffId: r.staff_id, staffName: r.staff_name, color: r.color, resourceNames: r.resource_names, price: r.price, notes: r.notes,
  }));
}

export type BookingDetail = CalendarBooking & {
  locationId: string;
  source: "admin" | "public" | "demo";
  customerMessage: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
  bufferBefore: number;
  bufferAfter: number;
  history: { id: string; from: BookingStatus | null; to: BookingStatus; at: string; by: string | null; source: string; reason: string | null }[];
};

export async function getBookingDetail(tx: Tx, bookingId: string): Promise<BookingDetail | null> {
  const [r] = await tx<{
    id: string; version: number; location_id: string; starts_at: Date; ends_at: Date; status: BookingStatus; customer_id: string;
    customer_name: string | null; customer_phone: string | null; customer_email: string | null; service_id: string; service_name: string;
    staff_id: string | null; staff_name: string | null; color: string; resource_names: string | null; price: number; notes: string | null;
    source: "admin" | "public" | "demo"; customer_message: string | null; cancel_reason: string | null; cancelled_at: Date | null; created_at: Date;
    buffer_before_minutes: number; buffer_after_minutes: number;
  }[]>`
    select b.*, c.name customer_name, c.phone customer_phone, c.email customer_email, s.name service_name, st.name staff_name,
           coalesce(st.color, s.color) color,
           (select string_agg(r.name, '、') from public.booking_resources br join public.resources r on r.id = br.resource_id where br.booking_id = b.id) resource_names
      from public.bookings b
      join public.services s on s.id = b.service_id
      left join public.customers c on c.id = b.customer_id
      left join public.staff st on st.id = b.staff_id
     where b.id = ${bookingId}`;
  if (!r) return null;
  const history = await tx<{ id: string; from_status: BookingStatus | null; to_status: BookingStatus; created_at: Date; by: string | null; source: string; reason: string | null }[]>`
    select h.id, h.from_status, h.to_status, h.created_at, h.source, h.reason,
           (select m.display_name from public.organization_members m where m.user_id = h.changed_by and m.organization_id = h.organization_id) "by"
      from public.booking_status_history h where h.booking_id = ${bookingId} order by h.created_at, h.id`;
  return {
    id: r.id, version: r.version, locationId: r.location_id, startsAt: r.starts_at.toISOString(), endsAt: r.ends_at.toISOString(), status: r.status,
    customerId: r.customer_id, customerName: r.customer_name ?? "（表示できません）", customerPhone: r.customer_phone, customerEmail: r.customer_email,
    serviceId: r.service_id, serviceName: r.service_name, staffId: r.staff_id, staffName: r.staff_name, color: r.color,
    resourceNames: r.resource_names, price: r.price, notes: r.notes, source: r.source, customerMessage: r.customer_message,
    cancelReason: r.cancel_reason, cancelledAt: r.cancelled_at?.toISOString() ?? null, createdAt: r.created_at.toISOString(),
    bufferBefore: r.buffer_before_minutes, bufferAfter: r.buffer_after_minutes,
    history: history.map((h) => ({ id: h.id, from: h.from_status, to: h.to_status, at: h.created_at.toISOString(), by: h.by, source: h.source, reason: h.reason })),
  };
}

export type BookingListFilters = {
  q?: string;
  status?: BookingStatus | "active" | "";
  staffId?: string;
  serviceId?: string;
  from?: Date;
  to?: Date;
  sort: "starts_at" | "price" | "created_at";
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
};

export type BookingListRow = {
  id: string; startsAt: string; endsAt: string; status: BookingStatus; customerId: string; customerName: string;
  serviceName: string; staffName: string | null; price: number; source: string; createdAt: string;
};

export async function listBookings(tx: Tx, locationId: string, f: BookingListFilters): Promise<{ rows: BookingListRow[]; total: number }> {
  const q = f.q?.trim() ? `%${f.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const where = tx`
    b.location_id = ${locationId}
    ${f.status === "active" ? tx`and public.booking_blocks_slot(b.status)` : f.status ? tx`and b.status = ${f.status}` : tx``}
    ${f.staffId ? tx`and b.staff_id = ${f.staffId}` : tx``}
    ${f.serviceId ? tx`and b.service_id = ${f.serviceId}` : tx``}
    ${f.from ? tx`and b.starts_at >= ${f.from}` : tx``}
    ${f.to ? tx`and b.starts_at < ${f.to}` : tx``}
    ${q ? tx`and (c.name ilike ${q} or c.name_kana ilike ${q} or c.phone ilike ${q} or c.email ilike ${q} or s.name ilike ${q})` : tx``}`;
  const order = {
    starts_at: tx`b.starts_at`,
    price: tx`b.price`,
    created_at: tx`b.created_at`,
  }[f.sort];
  const [rows, [count]] = await Promise.all([
    tx<{ id: string; starts_at: Date; ends_at: Date; status: BookingStatus; customer_id: string; customer_name: string | null; service_name: string; staff_name: string | null; price: number; source: string; created_at: Date }[]>`
      select b.id, b.starts_at, b.ends_at, b.status, b.customer_id, c.name customer_name, s.name service_name, st.name staff_name, b.price, b.source, b.created_at
        from public.bookings b
        join public.services s on s.id = b.service_id
        left join public.customers c on c.id = b.customer_id
        left join public.staff st on st.id = b.staff_id
       where ${where}
       order by ${order} ${f.dir === "asc" ? tx`asc` : tx`desc`}, b.id
       limit ${f.pageSize} offset ${(f.page - 1) * f.pageSize}`,
    tx<{ n: number }[]>`
      select count(*)::int n from public.bookings b
        join public.services s on s.id = b.service_id
        left join public.customers c on c.id = b.customer_id
       where ${where}`,
  ]);
  return {
    total: count.n,
    rows: rows.map((r) => ({
      id: r.id, startsAt: r.starts_at.toISOString(), endsAt: r.ends_at.toISOString(), status: r.status, customerId: r.customer_id,
      customerName: r.customer_name ?? "（表示できません）", serviceName: r.service_name, staffName: r.staff_name, price: r.price,
      source: r.source, createdAt: r.created_at.toISOString(),
    })),
  };
}
