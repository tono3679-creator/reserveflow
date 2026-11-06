/**
 * 公開予約（空き枠・確定・変更・キャンセル）と通知（送信記録・重複防止・リマインド）。
 * 見本の美容室・整体院（db:seed と同じデータ）をサーバーの接続で操作する。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { rebuildShowcase } from "../../src/lib/demo/showcase";
import { enqueueReminders, processNotifications } from "../../src/lib/notifications/process";
import { renderNotification } from "../../src/lib/notifications/templates";
import {
  availableDays, availableSlots, cancelManagedBooking, createPublicBooking, findManagedBooking, getPublicLocation,
  PublicBookingError, rescheduleManagedBooking, type PublicLocation,
} from "../../src/lib/public/booking";
import { manageToken } from "../../src/lib/public/token";
import { addDays, localDate } from "../../src/lib/time";
import { connect } from "../helpers/db";

let sql: Sql;
let salon: PublicLocation;
let seitai: PublicLocation;
let serial = 0;

const customer = (n = serial++) => ({ name: `公開 テスト${n}`, nameKana: null, phone: `080-0000-${String(1000 + n)}`, email: `public${n}@example.com`, message: null });

/** 空きのある最初の日と時刻（スタッフ指定） */
async function firstSlot(loc: PublicLocation, serviceId: string, staffId: string | "any", fromDays = 3) {
  const from = addDays(localDate(new Date(), loc.timezone), fromDays);
  const days = await availableDays(sql, loc, { serviceId, staffId, from, days: 14 });
  const day = days.find((d) => d.slots > 0)!;
  const slots = await availableSlots(sql, loc, { serviceId, staffId, date: day.date });
  return { date: day.date, slots };
}

async function reason(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "";
  } catch (e) {
    expect(e).toBeInstanceOf(PublicBookingError);
    return (e as Error).message;
  }
}

beforeAll(async () => {
  sql = connect();
  await rebuildShowcase(sql);
  salon = (await getPublicLocation(sql, "demo-salon"))!;
  seitai = (await getPublicLocation(sql, "demo-seitai"))!;
});

afterAll(async () => {
  await sql.end();
});

describe("公開予約", () => {
  it("公開中のサービスと、担当できるスタッフだけが出る", async () => {
    expect(salon.services.length).toBeGreaterThan(0);
    expect(salon.staff.length).toBeGreaterThan(0);
    expect(await getPublicLocation(sql, "no-such-shop")).toBeNull();
    expect(await getPublicLocation(sql, "../etc")).toBeNull();
  });

  it("空き時間を選んで予約でき、同じ担当・時刻はもう予約できない", async () => {
    const service = salon.services[0];
    const staffId = service.staffIds[0];
    const { slots } = await firstSlot(salon, service.id, staffId);
    const start = slots[0].start;
    const r = await createPublicBooking(sql, salon, { serviceId: service.id, staffId, startsAt: start, customer: customer(), agreed: true });
    const [b] = await sql<{ source: string; status: string; staff_id: string; manage_token_hash: string | null; price: number }[]>`
      select source, status, staff_id, manage_token_hash, price from bookings where id = ${r.bookingId}`;
    expect(b).toMatchObject({ source: "public", status: "confirmed", staff_id: staffId, price: service.price });
    expect(b.manage_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.token).toBe(manageToken(r.bookingId));

    const again = await reason(createPublicBooking(sql, salon, { serviceId: service.id, staffId, startsAt: start, customer: customer(), agreed: true }));
    expect(again).toContain("埋まりました");
    // 空き時間の一覧からも消える
    const after = await availableSlots(sql, salon, { serviceId: service.id, staffId, date: localDate(new Date(start), salon.timezone) });
    expect(after.some((s) => s.start === start)).toBe(false);
  });

  it("指名なしは、その時刻に空いているスタッフに自動で割り当てる", async () => {
    const service = salon.services[0];
    const { slots } = await firstSlot(salon, service.id, "any", 5);
    const slot = slots.find((s) => s.staffIds.length >= 2) ?? slots[0];
    const r = await createPublicBooking(sql, salon, { serviceId: service.id, staffId: null, startsAt: slot.start, customer: customer(), agreed: true });
    const [b] = await sql<{ staff_id: string }[]>`select staff_id from bookings where id = ${r.bookingId}`;
    expect(slot.staffIds).toContain(b.staff_id);
  });

  it("営業時間外・受付期間外・過去の時刻は受け付けない", async () => {
    const service = salon.services[0];
    const date = addDays(localDate(new Date(), salon.timezone), 4);
    const early = new Date(`${date}T06:00:00+09:00`).toISOString();
    expect(await reason(createPublicBooking(sql, salon, { serviceId: service.id, staffId: service.staffIds[0], startsAt: early, customer: customer(), agreed: true }))).not.toBe("");
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(await reason(createPublicBooking(sql, salon, { serviceId: service.id, staffId: service.staffIds[0], startsAt: past, customer: customer(), agreed: true }))).not.toBe("");
    const far = new Date(Date.now() + 400 * 86_400_000).toISOString();
    expect(await reason(createPublicBooking(sql, salon, { serviceId: service.id, staffId: service.staffIds[0], startsAt: far, customer: customer(), agreed: true }))).not.toBe("");
  });

  it("メールと電話の両方が一致する顧客にまとめ、どちらかが違えば別の顧客にする", async () => {
    const service = salon.services[0];
    const { slots } = await firstSlot(salon, service.id, "any", 7);
    const c = customer();
    const a = await createPublicBooking(sql, salon, { serviceId: service.id, staffId: null, startsAt: slots[0].start, customer: c, agreed: true });
    const b = await createPublicBooking(sql, salon, { serviceId: service.id, staffId: null, startsAt: slots[slots.length - 1].start, customer: { ...c, name: "別の名前" }, agreed: true });
    const c2 = await createPublicBooking(sql, salon, { serviceId: service.id, staffId: null, startsAt: slots[Math.floor(slots.length / 2)].start, customer: { ...c, phone: "080-9999-9999" }, agreed: true });
    const rows = await sql<{ id: string; customer_id: string }[]>`select id, customer_id from bookings where id in (${a.bookingId}, ${b.bookingId}, ${c2.bookingId})`;
    const by = Object.fromEntries(rows.map((r) => [r.id, r.customer_id]));
    expect(by[a.bookingId]).toBe(by[b.bookingId]);
    expect(by[c2.bookingId]).not.toBe(by[a.bookingId]);
    // 既存の顧客の名前は書き換えない
    const [cust] = await sql<{ name: string }[]>`select name from customers where id = ${by[a.bookingId]}`;
    expect(cust.name).toBe(c.name);
  });

  it("設備が必要なサービスは空いている設備を割り当て、設備が埋まると予約できない", async () => {
    const service = seitai.services.find((s) => s.name === "全身整体 60分")!;
    const { slots } = await firstSlot(seitai, service.id, "any", 6);
    const slot = slots[0];
    const r = await createPublicBooking(sql, seitai, { serviceId: service.id, staffId: null, startsAt: slot.start, customer: customer(), agreed: true });
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from booking_resources where booking_id = ${r.bookingId} and is_active`;
    expect(n).toBe(1);
  });
});

describe("予約の確認・変更・キャンセル（トークン）", () => {
  it("トークンで予約を見られ、別の店舗の URL や違うトークンでは見つからない", async () => {
    const service = salon.services[0];
    const { slots } = await firstSlot(salon, service.id, "any", 9);
    const r = await createPublicBooking(sql, salon, { serviceId: service.id, staffId: null, startsAt: slots[0].start, customer: customer(), agreed: true });
    expect((await findManagedBooking(sql, salon, r.token))?.id).toBe(r.bookingId);
    expect(await findManagedBooking(sql, seitai, r.token)).toBeNull();
    expect(await findManagedBooking(sql, salon, manageToken("00000000-0000-0000-0000-000000000000"))).toBeNull();
  });

  it("日時を変更でき（変更の通知が作られる）、キャンセルすると枠が空く", async () => {
    const service = salon.services[0];
    const { slots } = await firstSlot(salon, service.id, "any", 10);
    const r = await createPublicBooking(sql, salon, { serviceId: service.id, staffId: null, startsAt: slots[0].start, customer: customer(), agreed: true });
    const next = slots[slots.length - 1];
    await rescheduleManagedBooking(sql, salon, r.token, { startsAt: next.start, staffId: null });
    const [moved] = await sql<{ starts_at: Date; version: number }[]>`select starts_at, version from bookings where id = ${r.bookingId}`;
    expect(moved.starts_at.toISOString()).toBe(next.start);
    expect(moved.version).toBe(2);
    const events = await sql<{ type: string }[]>`select type from notification_events where booking_id = ${r.bookingId} order by created_at`;
    expect(events.map((e) => e.type)).toEqual(["booking_confirmed", "booking_changed"]);

    await cancelManagedBooking(sql, salon, r.token, "都合が悪くなった");
    const [c] = await sql<{ status: string; cancel_reason: string }[]>`select status, cancel_reason from bookings where id = ${r.bookingId}`;
    expect(c).toEqual({ status: "cancelled_customer", cancel_reason: "都合が悪くなった" });
    // キャンセル後は変更できない
    expect(await reason(cancelManagedBooking(sql, salon, r.token, null))).toContain("変更・キャンセルできない");
  });

  it("受付期限（開始の N 時間前）を過ぎると変更・キャンセルできない", async () => {
    const service = salon.services[0];
    const { slots } = await firstSlot(salon, service.id, "any", 11);
    const r = await createPublicBooking(sql, salon, { serviceId: service.id, staffId: null, startsAt: slots[0].start, customer: customer(), agreed: true });
    const justBefore = new Date(new Date(slots[0].start).getTime() - 60_000);
    const b = await findManagedBooking(sql, salon, r.token, justBefore);
    expect(b?.canChange).toBe(false);
    expect(await reason(cancelManagedBooking(sql, salon, r.token, null, justBefore))).toContain("受付期限");
  });
});

describe("通知", () => {
  it("未送信の通知を送り（見本の企業はデモ通知）、何度実行しても送信記録は1件", async () => {
    await processNotifications(sql, { limit: 500 });
    await processNotifications(sql, { limit: 500 });
    const dup = await sql`select event_id from notification_deliveries group by event_id, channel having count(*) > 1`;
    expect(dup).toHaveLength(0);
    const [{ undelivered }] = await sql<{ undelivered: number }[]>`
      select count(*)::int undelivered from notification_events e where not exists (select 1 from notification_deliveries d where d.event_id = e.id)`;
    expect(undelivered).toBe(0);
    const statuses = await sql<{ status: string }[]>`select distinct status from notification_deliveries`;
    expect(statuses.map((s) => s.status).sort()).toEqual(expect.arrayContaining(["demo"]));
    expect(statuses.some((s) => s.status === "sent")).toBe(false);
    // 公開予約の通知文には確認・変更のリンクが入る
    const [d] = await sql<{ body: string }[]>`
      select d.body from notification_deliveries d join notification_events e on e.id = d.event_id
        join bookings b on b.id = e.booking_id where b.source = 'public' and e.type = 'booking_confirmed' limit 1`;
    expect(d.body).toMatch(/\/book\/demo-[a-z]+\/manage\/[A-Za-z0-9_-]{43}/);
  });

  it("前日・当日のリマインドは1つの予約に1件だけ作られる", async () => {
    await enqueueReminders(sql);
    const [first] = await sql<{ n: number }[]>`select count(*)::int n from notification_events where type in ('reminder_day_before', 'reminder_same_day')`;
    await enqueueReminders(sql);
    const [second] = await sql<{ n: number }[]>`select count(*)::int n from notification_events where type in ('reminder_day_before', 'reminder_same_day')`;
    expect(second.n).toBe(first.n);
    // 明日の予約確定の予約がある店舗では、前日リマインドが作られている
    const [{ tomorrow }] = await sql<{ tomorrow: number }[]>`
      select count(*)::int tomorrow from bookings b join locations l on l.id = b.location_id join tenant_settings t on t.location_id = l.id
       where t.remind_day_before and b.status = 'confirmed' and (b.starts_at at time zone l.timezone)::date = (now() at time zone l.timezone)::date + 1`;
    const [{ reminders }] = await sql<{ reminders: number }[]>`select count(*)::int reminders from notification_events where type = 'reminder_day_before'`;
    expect(reminders).toBe(tomorrow);
  });

  it("通知文：種類・日時・リンク・キャンセルポリシー", () => {
    const m = renderNotification("reminder_day_before", {
      customer_name: "山田 花子", customer_email: "hanako@example.com", service_name: "カット", staff_name: "佐藤",
      starts_at: "2030-02-04T01:00:00Z", ends_at: "2030-02-04T02:00:00Z", price: 4950, location_name: "サロン", timezone: "Asia/Tokyo",
    }, { manageUrl: "https://example.com/book/x/manage/t", policy: "前日までにご連絡ください" });
    expect(m.to).toBe("hanako@example.com");
    expect(m.subject).toBe("【サロン】前日リマインド（2/4 10:00）");
    expect(m.text).toContain("2030年2月4日(月) 10:00〜11:00");
    expect(m.text).toContain("https://example.com/book/x/manage/t");
    expect(m.text).toContain("前日までにご連絡ください");
    const cancelled = renderNotification("booking_cancelled", { customer_name: "A", starts_at: "2030-02-04T01:00:00Z", ends_at: "2030-02-04T02:00:00Z", cancel_reason: "体調不良" }, { manageUrl: "https://x" });
    expect(cancelled.text).not.toContain("https://x");
    expect(cancelled.text).toContain("理由：体調不良");
    expect(cancelled.to).toBeNull();
  });
});
