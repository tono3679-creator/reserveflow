import "server-only";
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import { checkSlot, openSlots } from "@/lib/scheduling/engine";
import { loadSchedulingContext, loadServiceSpecs } from "@/lib/scheduling/load";
import { addDays, localDate } from "@/lib/time";
import type { BookingStatus } from "@/lib/domain/booking";
import type { publicBookingSchema } from "@/lib/validation/public-booking";
import { manageToken, manageTokenHash } from "./token";

type Db = Sql | TransactionSql;

/** お客様に見せてよい失敗の理由 */
export class PublicBookingError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export type PublicLocation = {
  id: string; organizationId: string; slug: string; name: string; industry: string; phone: string | null; email: string | null;
  address: string | null; logoUrl: string | null; timezone: string; enabled: boolean; staffSelection: "required" | "optional" | "none";
  maxAdvanceDays: number; minLeadMinutes: number; cancelDeadlineHours: number; cancellationPolicy: string; isDemo: boolean;
  services: { id: string; name: string; category: string | null; description: string | null; price: number; durationMinutes: number; staffIds: string[] }[];
  staff: { id: string; name: string; title: string | null; color: string }[];
};

/** 公開予約ページに出す店舗の情報（公開中のサービスと、それを担当できるスタッフだけ） */
export async function getPublicLocation(sql: Db, slug: string): Promise<PublicLocation | null> {
  if (!/^[a-z0-9-]{3,50}$/.test(slug)) return null;
  const [l] = await sql<{
    id: string; organization_id: string; slug: string; name: string; industry: string; phone: string | null; email: string | null; address: string | null;
    logo_url: string | null; timezone: string; public_booking_enabled: boolean; staff_selection: PublicLocation["staffSelection"];
    max_advance_days: number; min_lead_minutes: number; cancel_deadline_hours: number; cancellation_policy: string; is_demo: boolean;
  }[]>`
    select l.id, l.organization_id, l.slug, l.name, l.industry, l.phone, l.email, l.address, l.logo_url, l.timezone,
           t.public_booking_enabled, t.staff_selection, t.max_advance_days, t.min_lead_minutes, t.cancel_deadline_hours, t.cancellation_policy,
           (o.is_demo or o.is_showcase) is_demo
      from public.locations l
      join public.tenant_settings t on t.location_id = l.id
      join public.organizations o on o.id = l.organization_id
     where l.slug = ${slug} and l.is_active and (not o.is_demo or o.demo_expires_at > now())`;
  if (!l) return null;
  const services = await loadServiceSpecs(sql, l.id, { publicOnly: true });
  const staffIds = new Set(services.flatMap((s) => s.staffIds));
  const staff = l.staff_selection === "none" ? [] : await sql<{ id: string; name: string; title: string | null; color: string }[]>`
    select id, name, title, color from public.staff where location_id = ${l.id} and is_active order by sort_order, name`;
  return {
    id: l.id, organizationId: l.organization_id, slug: l.slug, name: l.name, industry: l.industry, phone: l.phone, email: l.email, address: l.address,
    logoUrl: l.logo_url, timezone: l.timezone, enabled: l.public_booking_enabled, staffSelection: l.staff_selection,
    maxAdvanceDays: l.max_advance_days, minLeadMinutes: l.min_lead_minutes, cancelDeadlineHours: l.cancel_deadline_hours,
    cancellationPolicy: l.cancellation_policy, isDemo: l.is_demo,
    services: services
      .filter((s) => l.staff_selection === "none" || s.staffIds.length > 0)
      .map((s) => ({ id: s.id, name: s.name, category: s.category, description: s.description, price: s.price, durationMinutes: s.durationMinutes, staffIds: s.staffIds })),
    staff: staff.filter((s) => staffIds.has(s.id)),
  };
}

export type PublicSlot = { start: string; end: string; staffIds: string[] };

async function prepare(sql: Db, loc: PublicLocation, serviceId: string, from: string, to: string) {
  const [services, ctx] = await Promise.all([
    loadServiceSpecs(sql, loc.id, { publicOnly: true }),
    loadSchedulingContext(sql, loc.id, from, to),
  ]);
  const service = services.find((s) => s.id === serviceId);
  if (!service || !ctx) throw new PublicBookingError("このサービスは予約できません", 404);
  return { service, ctx };
}

function group(slots: { start: number; end: number; staffId: string | null }[]): PublicSlot[] {
  const map = new Map<number, PublicSlot>();
  for (const s of slots) {
    const g = map.get(s.start) ?? { start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString(), staffIds: [] };
    if (s.staffId) g.staffIds.push(s.staffId);
    map.set(s.start, g);
  }
  return [...map.values()];
}

/** その日の空き時間（「指名なし」は担当できるスタッフのだれかが空いている時刻） */
export async function availableSlots(
  sql: Db, loc: PublicLocation, q: { serviceId: string; staffId: string | "any"; date: string; excludeBookingId?: string; now?: Date },
): Promise<PublicSlot[]> {
  const now = (q.now ?? new Date()).getTime();
  const { service, ctx } = await prepare(sql, loc, q.serviceId, q.date, q.date);
  return group(openSlots(ctx, service, { date: q.date, staffId: q.staffId, now, excludeBookingId: q.excludeBookingId }));
}

/** 日付ごとの空き時間の数（日付の選択に使う） */
export async function availableDays(
  sql: Db, loc: PublicLocation, q: { serviceId: string; staffId: string | "any"; from: string; days: number; excludeBookingId?: string; now?: Date },
): Promise<{ date: string; slots: number }[]> {
  const now = (q.now ?? new Date()).getTime();
  const to = addDays(q.from, q.days - 1);
  const { service, ctx } = await prepare(sql, loc, q.serviceId, q.from, to);
  const result: { date: string; slots: number }[] = [];
  for (let d = q.from; d <= to; d = addDays(d, 1)) {
    result.push({ date: d, slots: group(openSlots(ctx, service, { date: d, staffId: q.staffId, now, excludeBookingId: q.excludeBookingId })).length });
  }
  return result;
}

/**
 * 予約の確定時に、表示した空き状況をそのまま信じず同じ条件で判定し直す。
 * 「指名なし」なら、その時刻に空いているスタッフのうち、その日の予約が少ない人を選ぶ（負担の平準化）。
 */
async function resolveSlot(
  tx: Db, loc: PublicLocation, input: { serviceId: string; staffId: string | null; start: Date; excludeBookingId?: string }, now: Date,
) {
  const date = localDate(input.start, loc.timezone);
  const { service, ctx } = await prepare(tx, loc, input.serviceId, date, date);
  const startMs = input.start.getTime();
  const endMs = startMs + service.durationMinutes * 60_000;
  let staffId: string | null = null;
  if (ctx.staffSelection !== "none") {
    if (input.staffId) {
      staffId = input.staffId;
    } else {
      const candidates = openSlots(ctx, service, { date, staffId: "any", now: now.getTime(), excludeBookingId: input.excludeBookingId })
        .filter((s) => s.start === startMs && s.staffId)
        .map((s) => s.staffId!);
      if (candidates.length === 0) throw new PublicBookingError("その時間はちょうど埋まりました。別の時間を選んでください。", 409);
      const load = (id: string) => ctx.bookings.filter((b) => b.staffId === id && localDate(new Date(b.start), loc.timezone) === date).length;
      staffId = [...candidates].sort((a, b) => load(a) - load(b))[0];
    }
  }
  const issues = checkSlot(ctx, service, {
    staffId, start: startMs, end: endMs, excludeBookingId: input.excludeBookingId, now: now.getTime(), enforceBookingWindow: true,
  });
  // 管理画面と違い、公開予約では営業時間外・勤務時間外も受け付けない
  if (issues.length > 0) {
    const conflict = issues.some((i) => i.code === "staff_conflict" || i.code === "resource_unavailable");
    throw new PublicBookingError(conflict ? "その時間はちょうど埋まりました。別の時間を選んでください。" : issues[0].message, conflict ? 409 : 400);
  }
  return { service, staffId, start: input.start, end: new Date(endMs) };
}

function isExclusionError(e: unknown) {
  return !!e && typeof e === "object" && "code" in e && (e as { code: string }).code === "23P01";
}

/**
 * 公開ページからの予約。顧客は「メールアドレスと電話番号の両方が一致する」既存の顧客にまとめ、
 * それ以外は新しい顧客として登録する（他人の顧客情報を書き換えたり、見せたりしない）。
 */
export async function createPublicBooking(sql: Sql, loc: PublicLocation, input: z.output<typeof publicBookingSchema>, now = new Date()): Promise<{ bookingId: string; token: string }> {
  if (!loc.enabled) throw new PublicBookingError("現在、Web予約を受け付けていません。お電話でお問い合わせください。", 403);
  if (!loc.services.some((s) => s.id === input.serviceId)) throw new PublicBookingError("このサービスは予約できません", 404);
  if (input.staffId && !loc.staff.some((s) => s.id === input.staffId)) throw new PublicBookingError("このスタッフは選べません", 404);
  try {
    return await sql.begin(async (tx) => {
      const slot = await resolveSlot(tx, loc, { serviceId: input.serviceId, staffId: input.staffId, start: new Date(input.startsAt) }, now);
      const c = input.customer;
      const digits = c.phone.replace(/\D/g, "");
      const [existing] = await tx<{ id: string }[]>`
        select id from public.customers
         where organization_id = ${loc.organizationId} and lower(email) = lower(${c.email})
           and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = ${digits}
         order by created_at limit 1`;
      const customerId = existing?.id ?? (await tx<{ id: string }[]>`
        insert into public.customers (organization_id, name, name_kana, phone, email, source)
        values (${loc.organizationId}, ${c.name}, ${c.nameKana}, ${c.phone}, ${c.email}, 'public') returning id`)[0].id;
      const service = loc.services.find((s) => s.id === input.serviceId)!;
      const [{ id }] = await tx<{ id: string }[]>`
        select public.create_booking(${loc.id}, ${customerId}, ${input.serviceId}, ${slot.staffId}, ${slot.start}, ${slot.end},
          ${service.price}, null, 'confirmed', 'public', null, ${c.message}) id`;
      const token = manageToken(id);
      await tx`update public.bookings set manage_token_hash = ${manageTokenHash(token)} where id = ${id}`;
      return { bookingId: id, token };
    });
  } catch (e) {
    if (isExclusionError(e)) throw new PublicBookingError("その時間はちょうど埋まりました。別の時間を選んでください。", 409);
    throw e;
  }
}

export type ManagedBooking = {
  id: string; version: number; status: BookingStatus; startsAt: string; endsAt: string; serviceId: string; serviceName: string;
  staffId: string | null; staffName: string | null; price: number; customerName: string; customerMessage: string | null;
  canChange: boolean; changeDeadline: string; reasonIfLocked: string | null;
};

/** トークンから予約を探す（別の店舗の URL では見つからない扱い） */
export async function findManagedBooking(sql: Db, loc: PublicLocation, token: string, now = new Date()): Promise<ManagedBooking | null> {
  const [b] = await sql<{
    id: string; version: number; status: BookingStatus; starts_at: Date; ends_at: Date; service_id: string; service_name: string;
    staff_id: string | null; staff_name: string | null; price: number; customer_name: string; customer_message: string | null; location_id: string;
  }[]>`
    select b.id, b.version, b.status, b.starts_at, b.ends_at, b.service_id, s.name service_name, b.staff_id, st.name staff_name, b.price,
           c.name customer_name, b.customer_message, b.location_id
      from public.bookings b
      join public.services s on s.id = b.service_id
      join public.customers c on c.id = b.customer_id
      left join public.staff st on st.id = b.staff_id
     where b.manage_token_hash = ${manageTokenHash(token)}`;
  if (!b || b.location_id !== loc.id) return null;
  const deadline = new Date(b.starts_at.getTime() - loc.cancelDeadlineHours * 3_600_000);
  const reasonIfLocked = b.status !== "confirmed"
    ? "この予約は変更・キャンセルできない状態です。"
    : now > deadline
      ? `変更・キャンセルの受付期限（開始の${loc.cancelDeadlineHours}時間前）を過ぎています。お手数ですが店舗へお電話ください。`
      : null;
  return {
    id: b.id, version: b.version, status: b.status, startsAt: b.starts_at.toISOString(), endsAt: b.ends_at.toISOString(),
    serviceId: b.service_id, serviceName: b.service_name, staffId: b.staff_id, staffName: b.staff_name, price: b.price,
    customerName: b.customer_name, customerMessage: b.customer_message, canChange: reasonIfLocked === null,
    changeDeadline: deadline.toISOString(), reasonIfLocked,
  };
}

export async function cancelManagedBooking(sql: Sql, loc: PublicLocation, token: string, reason: string | null, now = new Date()): Promise<void> {
  const b = await findManagedBooking(sql, loc, token, now);
  if (!b) throw new PublicBookingError("予約が見つかりません", 404);
  if (!b.canChange) throw new PublicBookingError(b.reasonIfLocked!, 409);
  await sql`select public.set_booking_status(${b.id}, ${b.version}, 'cancelled_customer', ${reason ?? "Web からキャンセル"}, 'public')`;
}

export async function rescheduleManagedBooking(
  sql: Sql, loc: PublicLocation, token: string, input: { startsAt: string; staffId: string | null }, now = new Date(),
): Promise<void> {
  const b = await findManagedBooking(sql, loc, token, now);
  if (!b) throw new PublicBookingError("予約が見つかりません", 404);
  if (!b.canChange) throw new PublicBookingError(b.reasonIfLocked!, 409);
  if (input.staffId && !loc.staff.some((s) => s.id === input.staffId)) throw new PublicBookingError("このスタッフは選べません", 404);
  try {
    await sql.begin(async (tx) => {
      const slot = await resolveSlot(tx, loc, { serviceId: b.serviceId, staffId: input.staffId, start: new Date(input.startsAt), excludeBookingId: b.id }, now);
      const [row] = await tx<{ customer_id: string; notes: string | null }[]>`select customer_id, notes from public.bookings where id = ${b.id}`;
      await tx`select public.update_booking(${b.id}, ${b.version}, ${row.customer_id}, ${b.serviceId}, ${slot.staffId}, ${slot.start}, ${slot.end},
        ${b.price}, ${row.notes ?? ""}, null, 'public')`;
    });
  } catch (e) {
    if (isExclusionError(e)) throw new PublicBookingError("その時間はちょうど埋まりました。別の時間を選んでください。", 409);
    throw e;
  }
}

/** 予約の確認・変更リンクの受け付け期間の目安（ページの表示用） */
export function bookableRange(loc: PublicLocation, now = new Date()): { from: string; to: string } {
  const today = localDate(now, loc.timezone);
  return { from: today, to: addDays(today, loc.maxAdvanceDays) };
}
