import type { Sql, TransactionSql } from "postgres";
import type { Dataset } from "./generate";

export type MemberSeed = { userId: string; role: "owner" | "manager" | "staff"; displayName: string; staffKey?: string };

type Db = Sql | TransactionSql;

/** 大量の行を分けて入れる（1回の SQL のパラメータ数の上限を超えないように） */
async function insertMany(tx: Db, table: string, rows: Record<string, unknown>[], chunk = 500): Promise<void> {
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    if (part.length === 0) continue;
    // 値はすべてパラメータとして送る（表名はこのファイルの固定値だけ）
    await tx`insert into ${tx(table)} ${tx(part as Record<string, never>[])}`;
  }
}

/**
 * 生成したデータを DB に入れる（DB の所有者の接続・1トランザクションで呼ぶ）。
 * 予約は DB の排他制約・外部キーの検査を通るので、生成の誤りがあればここで失敗する。
 */
export async function insertDataset(
  tx: Db,
  data: Dataset,
  options: { members: MemberSeed[]; isDemo: boolean; isShowcase?: boolean; demoSessionId?: string; demoExpiresAt?: Date },
): Promise<void> {
  const org = data.organization.id;
  const loc = data.location.id;
  await tx`insert into public.organizations (id, name, is_demo, is_showcase, demo_session_id, demo_expires_at)
    values (${org}, ${data.organization.name}, ${options.isDemo}, ${options.isShowcase ?? false},
            ${options.demoSessionId ?? null}, ${options.demoExpiresAt ?? null})`;
  await tx`insert into public.locations (id, organization_id, name, slug, industry, phone, email, address, timezone)
    values (${loc}, ${org}, ${data.location.name}, ${data.location.slug}, ${data.location.industry}, ${data.location.phone},
            ${data.location.email}, ${data.location.address}, ${data.location.timezone})`;
  await tx`insert into public.tenant_settings (location_id, organization_id, staff_selection, slot_interval_minutes, cancellation_policy)
    values (${loc}, ${org}, ${data.settings.staffSelection}, ${data.settings.slotInterval}, ${data.settings.cancellationPolicy})`;
  await insertMany(tx, "business_hours", data.hours.map((h) => ({
    organization_id: org, location_id: loc, weekday: h.weekday, opens_at: h.opens, closes_at: h.closes,
  })));
  await insertMany(tx, "business_hour_exceptions", data.exceptions.map((e) => ({
    organization_id: org, location_id: loc, date: e.date, is_closed: true, note: e.note,
  })));

  const memberIds = new Map<string, string>();
  for (const m of options.members) {
    const [row] = await tx<{ id: string }[]>`insert into public.organization_members (organization_id, user_id, role, display_name)
      values (${org}, ${m.userId}, ${m.role}, ${m.displayName}) returning id`;
    if (m.staffKey) memberIds.set(m.staffKey, row.id);
  }
  await insertMany(tx, "staff", data.staff.map((s) => ({
    id: s.id, organization_id: org, location_id: loc, member_id: memberIds.get(s.key) ?? null, name: s.name, email: s.email,
    title: s.title, color: s.color, sort_order: s.sortOrder,
  })));
  await insertMany(tx, "staff_schedules", data.schedules.map((s) => ({
    organization_id: org, staff_id: s.staffId, weekday: s.weekday, starts_at: s.start, ends_at: s.end,
    break_starts_at: s.breakStart, break_ends_at: s.breakEnd,
  })));
  await insertMany(tx, "staff_time_off", data.timeOff.map((t) => ({
    organization_id: org, staff_id: t.staffId, date: t.date, kind: "day_off", reason: t.reason,
  })));
  await insertMany(tx, "services", data.services.map((s) => ({
    id: s.id, organization_id: org, location_id: loc, name: s.bp.name, category: s.bp.category, description: s.bp.description,
    price: s.bp.price, duration_minutes: s.bp.duration, buffer_before_minutes: s.bp.bufferBefore ?? 0,
    buffer_after_minutes: s.bp.bufferAfter ?? 0, color: s.bp.color, is_public: s.bp.isPublic ?? true, sort_order: s.sortOrder,
  })));
  await insertMany(tx, "service_staff", data.serviceStaff.map((s) => ({ organization_id: org, service_id: s.serviceId, staff_id: s.staffId })));
  await insertMany(tx, "resources", data.resources.map((r) => ({
    id: r.id, organization_id: org, location_id: loc, name: r.name, kind: r.kind, sort_order: r.sortOrder,
  })));
  await insertMany(tx, "service_resources", data.serviceResources.map((s) => ({ organization_id: org, service_id: s.serviceId, resource_id: s.resourceId })));
  await insertMany(tx, "customers", data.customers.map((c) => ({
    id: c.id, organization_id: org, name: c.name, name_kana: c.kana, phone: c.phone, email: c.email,
    preferred_staff_id: c.preferredStaffId, source: "admin", created_at: c.createdAt, updated_at: c.createdAt,
  })));
  await insertMany(tx, "customer_notes", data.notes.map((n) => ({
    organization_id: org, customer_id: n.customerId, body: n.body, created_at: n.createdAt, updated_at: n.createdAt,
  })));
  await insertMany(tx, "bookings", data.bookings.map((b) => ({
    id: b.id, organization_id: org, location_id: loc, customer_id: b.customerId, service_id: b.serviceId, staff_id: b.staffId,
    starts_at: b.startsAt, ends_at: b.endsAt, buffer_before_minutes: b.bufferBefore, buffer_after_minutes: b.bufferAfter,
    // 占有時間はトリガーが計算し直す（ここでは仮の値）
    occupied: `[${b.startsAt.toISOString()},${b.endsAt.toISOString()})`,
    price: b.price, status: b.status, notes: b.notes, source: b.source, cancelled_at: b.cancelledAt, cancel_reason: b.cancelReason,
    created_at: b.createdAt, updated_at: b.history[b.history.length - 1].at,
  })));
  await insertMany(tx, "booking_resources", data.bookings.filter((b) => b.resourceId).map((b) => ({
    organization_id: org, booking_id: b.id, resource_id: b.resourceId,
    occupied: `[${new Date(b.startsAt.getTime() - b.bufferBefore * 60_000).toISOString()},${new Date(b.endsAt.getTime() + b.bufferAfter * 60_000).toISOString()})`,
    is_active: b.status === "confirmed" || b.status === "checked_in" || b.status === "completed",
  })));
  await insertMany(tx, "booking_status_history", data.bookings.flatMap((b) => b.history.map((h) => ({
    organization_id: org, booking_id: b.id, from_status: h.from, to_status: h.to, source: b.source, reason: h.reason, created_at: h.at,
  }))));
}
