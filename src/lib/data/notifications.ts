import "server-only";
import type { Tx } from "@/lib/db";
import type { NotificationType } from "@/lib/notifications/templates";

export type DeliveryState = "unsent" | "pending" | "sent" | "demo" | "skipped" | "failed";

export type NotificationRow = {
  id: string; type: NotificationType; createdAt: string; bookingId: string | null; customerName: string | null; startsAt: string | null;
  deliveryId: string | null; status: DeliveryState; recipient: string | null; provider: string | null; subject: string | null; body: string | null;
  attempts: number; lastError: string | null; sentAt: string | null;
};

export type NotificationFilters = { type?: NotificationType; status?: DeliveryState; q?: string; page: number; pageSize: number };

/** 通知の履歴（イベントと送信の状態）。RLS でオーナー・マネージャーだけが読める */
export async function listNotifications(tx: Tx, locationId: string, f: NotificationFilters): Promise<{ rows: NotificationRow[]; total: number }> {
  const like = f.q ? `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const where = tx`
    e.location_id = ${locationId}
    ${f.type ? tx`and e.type = ${f.type}` : tx``}
    ${f.status === "unsent" ? tx`and d.id is null` : f.status ? tx`and d.status = ${f.status}` : tx``}
    ${like ? tx`and (e.payload->>'customer_name' ilike ${like} or d.recipient ilike ${like})` : tx``}`;
  const [rows, [{ total }]] = await Promise.all([
    tx<{
      id: string; type: NotificationType; created_at: Date; booking_id: string | null; customer_name: string | null; starts_at: string | null;
      delivery_id: string | null; status: DeliveryState | null; recipient: string | null; provider: string | null; subject: string | null; body: string | null;
      attempts: number | null; last_error: string | null; sent_at: Date | null;
    }[]>`
      select e.id, e.type, e.created_at, e.booking_id, e.payload->>'customer_name' customer_name, e.payload->>'starts_at' starts_at,
             d.id delivery_id, d.status, d.recipient, d.provider, d.subject, d.body, d.attempts, d.last_error, d.sent_at
        from public.notification_events e
        left join public.notification_deliveries d on d.event_id = e.id and d.channel = 'email'
       where ${where}
       order by e.created_at desc, e.id
       limit ${f.pageSize} offset ${(f.page - 1) * f.pageSize}`,
    tx<{ total: number }[]>`
      select count(*)::int total
        from public.notification_events e
        left join public.notification_deliveries d on d.event_id = e.id and d.channel = 'email'
       where ${where}`,
  ]);
  return {
    total,
    rows: rows.map((r) => ({
      id: r.id, type: r.type, createdAt: r.created_at.toISOString(), bookingId: r.booking_id, customerName: r.customer_name, startsAt: r.starts_at,
      deliveryId: r.delivery_id, status: r.status ?? "unsent", recipient: r.recipient, provider: r.provider, subject: r.subject, body: r.body,
      attempts: r.attempts ?? 0, lastError: r.last_error, sentAt: r.sent_at?.toISOString() ?? null,
    })),
  };
}

/** 状態ごとの件数（直近30日） */
export async function notificationCounts(tx: Tx, locationId: string): Promise<Record<DeliveryState, number>> {
  const rows = await tx<{ status: DeliveryState; n: number }[]>`
    select coalesce(d.status::text, 'unsent') status, count(*)::int n
      from public.notification_events e
      left join public.notification_deliveries d on d.event_id = e.id and d.channel = 'email'
     where e.location_id = ${locationId} and e.created_at > now() - interval '30 days'
     group by 1`;
  const out: Record<DeliveryState, number> = { unsent: 0, pending: 0, sent: 0, demo: 0, skipped: 0, failed: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}
