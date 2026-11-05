import "server-only";
import type { Sql } from "postgres";
import { manageUrl } from "@/lib/public/token";
import { pickAdapter } from "./adapters";
import { renderNotification, type NotificationPayload, type NotificationType } from "./templates";

const MAX_ATTEMPTS = 3;

type PendingEvent = {
  event_id: string; organization_id: string; type: NotificationType; payload: NotificationPayload; booking_id: string | null;
  slug: string; has_token: boolean; policy: string | null; is_demo: boolean; is_showcase: boolean;
};

/**
 * まだ送っていない通知イベントを送る（失敗したものは3回まで再試行）。
 * 1つのイベントの送信記録は1件だけ（unique (event_id, channel)）。先に記録を作れた処理だけが送るので、
 * 同時に動いても二重に送らない。
 */
export async function processNotifications(sql: Sql, options: { organizationId?: string; limit?: number } = {}): Promise<{ processed: number }> {
  const limit = options.limit ?? 50;
  const events = await sql<PendingEvent[]>`
    select e.id event_id, e.organization_id, e.type, e.payload, e.booking_id, l.slug,
           (b.manage_token_hash is not null) has_token, t.cancellation_policy policy, o.is_demo, o.is_showcase
      from public.notification_events e
      join public.locations l on l.id = e.location_id
      join public.organizations o on o.id = e.organization_id
      left join public.tenant_settings t on t.location_id = e.location_id
      left join public.bookings b on b.id = e.booking_id
      left join public.notification_deliveries d on d.event_id = e.id and d.channel = 'email'
     where (d.id is null or (d.status in ('pending', 'failed') and d.attempts < ${MAX_ATTEMPTS} and d.updated_at < now() - interval '1 minute'))
       ${options.organizationId ? sql`and e.organization_id = ${options.organizationId}` : sql``}
     order by e.created_at
     limit ${limit}`;
  let processed = 0;
  for (const e of events) {
    const message = renderNotification(e.type, e.payload, {
      manageUrl: e.has_token && e.booking_id ? manageUrl(e.slug, e.booking_id) : null,
      policy: e.policy,
    });
    // 送信の権利を取る（新しく作れたとき、または再試行の対象を更新できたときだけ送る）
    const [claimed] = await sql<{ id: string }[]>`
      insert into public.notification_deliveries (organization_id, event_id, channel, recipient, status, subject, body, attempts)
      values (${e.organization_id}, ${e.event_id}, 'email', ${message.to}, 'pending', ${message.subject}, ${message.text}, 1)
      on conflict (event_id, channel) do update set attempts = notification_deliveries.attempts + 1, updated_at = now()
        where notification_deliveries.status in ('pending', 'failed') and notification_deliveries.attempts < ${MAX_ATTEMPTS}
          and notification_deliveries.updated_at < now() - interval '1 minute'
      returning id`;
    if (!claimed) continue;
    processed++;
    if (!message.to) {
      await sql`update public.notification_deliveries set status = 'skipped', last_error = 'メールアドレスが登録されていません', updated_at = now() where id = ${claimed.id}`;
      continue;
    }
    const adapter = pickAdapter({ isDemo: e.is_demo, isShowcase: e.is_showcase });
    const result = await adapter.send({ to: message.to, subject: message.subject, text: message.text });
    await sql`update public.notification_deliveries
       set status = ${result.status}, provider = ${result.provider}, last_error = ${result.error ?? null},
           sent_at = ${result.status === "failed" ? null : new Date()}, updated_at = now()
     where id = ${claimed.id}`;
  }
  return { processed };
}

/**
 * 前日・当日のリマインドの通知イベントを作る（店舗設定でオンの店舗だけ）。
 * 前日：明日（店舗の日付）に始まる予約確定の予約。当日：今日これから始まる予約確定の予約。
 * dedupe_key があるので、何度実行しても1つの予約に同じ種類のリマインドは1件だけ（checked は対象にした予約の数）。
 */
export async function enqueueReminders(sql: Sql, now = new Date(), options: { locationId?: string } = {}): Promise<{ checked: number }> {
  const only = options.locationId ? sql`and b.location_id = ${options.locationId}` : sql``;
  const rows = await sql<{ n: number }[]>`
    with targets as (
      select b.id, 'reminder_day_before'::public.notification_type type
        from public.bookings b
        join public.locations l on l.id = b.location_id
        join public.tenant_settings t on t.location_id = b.location_id
       where t.remind_day_before and b.status = 'confirmed'
         and (b.starts_at at time zone l.timezone)::date = ((${now}::timestamptz at time zone l.timezone)::date + 1)
         ${only}
      union all
      select b.id, 'reminder_same_day'::public.notification_type
        from public.bookings b
        join public.locations l on l.id = b.location_id
        join public.tenant_settings t on t.location_id = b.location_id
       where t.remind_same_day and b.status = 'confirmed' and b.starts_at > ${now}
         and (b.starts_at at time zone l.timezone)::date = (${now}::timestamptz at time zone l.timezone)::date
         ${only}
    ), created as (
      select app_private.enqueue_notification(id, type, type || ':' || id) from targets
    )
    select count(*)::int n from created`;
  return { checked: rows[0]?.n ?? 0 };
}
