/**
 * 予約の作成・変更・ステータス変更（DB 関数）と、役割ごとの操作制限。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { rebuildShowcase } from "../../src/lib/demo/showcase";
import { as, connect, errorCode } from "../helpers/db";

let sql: Sql;
let owner: string, manager: string, staffUser: string;
let salon: { org: string; loc: string; customer: string; cut: string; myStaff: string; otherStaff: string; spaOnlyStaff: string };
let seitai: { loc: string; customer: string; service: string; noResourceService: string; staff: string[] };
const at = (day: number, hhmm: string) => new Date(`2030-02-${String(day).padStart(2, "0")}T${hhmm}:00+09:00`);

async function message(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

function create(user: string, o: Partial<{ loc: string; customer: string; service: string; staff: string | null; start: Date; end: Date; price: number; status: string; resource: string | null }>) {
  return as(sql, user, (tx) => tx<{ id: string }[]>`
    select public.create_booking(${o.loc ?? salon.loc}, ${o.customer ?? salon.customer}, ${o.service ?? salon.cut},
      ${o.staff === undefined ? salon.myStaff : o.staff}, ${o.start ?? at(4, "10:00")}, ${o.end ?? at(4, "11:00")},
      ${o.price ?? 4950}, null, ${o.status ?? "confirmed"}, 'admin', ${o.resource ?? null}) id`).then((r) => r[0].id);
}

async function version(id: string): Promise<number> {
  const [r] = await sql<{ version: number }[]>`select version from bookings where id = ${id}`;
  return r.version;
}

beforeAll(async () => {
  sql = connect();
  await rebuildShowcase(sql);
  const users = await sql<{ id: string; email: string }[]>`select id, email from auth.users where email like '%@reserveflow.example'`;
  owner = users.find((u) => u.email.startsWith("owner"))!.id;
  manager = users.find((u) => u.email.startsWith("manager"))!.id;
  staffUser = users.find((u) => u.email.startsWith("staff"))!.id;
  const [l] = await sql<{ org: string; loc: string }[]>`select organization_id org, id loc from locations where slug = 'demo-salon'`;
  const [cut] = await sql<{ id: string }[]>`select id from services where location_id = ${l.loc} and name = 'カット'`;
  const [mine] = await sql<{ id: string }[]>`select s.id from staff s join organization_members m on m.id = s.member_id where m.user_id = ${staffUser}`;
  const [other] = await sql<{ id: string }[]>`select s.id from staff s join service_staff ss on ss.staff_id = s.id where ss.service_id = ${cut.id} and s.id <> ${mine.id} limit 1`;
  const [spaOnly] = await sql<{ id: string }[]>`select s.id from staff s where s.location_id = ${l.loc} and not exists (select 1 from service_staff ss where ss.staff_id = s.id and ss.service_id = ${cut.id}) limit 1`;
  const [customer] = await sql<{ id: string }[]>`select id from customers where organization_id = ${l.org} limit 1`;
  salon = { org: l.org, loc: l.loc, customer: customer.id, cut: cut.id, myStaff: mine.id, otherStaff: other.id, spaOnlyStaff: spaOnly.id };
  const [s] = await sql<{ org: string; loc: string }[]>`select organization_id org, id loc from locations where slug = 'demo-seitai'`;
  const [svc] = await sql<{ id: string }[]>`select id from services where location_id = ${s.loc} and name = '全身整体 60分'`;
  const [plain] = await sql<{ id: string }[]>`select id from services where location_id = ${s.loc} and name like 'セルフケア%'`;
  const [c2] = await sql<{ id: string }[]>`select id from customers where organization_id = ${s.org} limit 1`;
  const staff = await sql<{ id: string }[]>`select id from staff where location_id = ${s.loc} order by sort_order`;
  seitai = { loc: s.loc, customer: c2.id, service: svc.id, noResourceService: plain.id, staff: staff.map((x) => x.id) };
});

afterAll(async () => {
  await sql`delete from bookings where starts_at >= '2030-01-01'`;
  await sql.end();
});

describe("予約の作成", () => {
  it("マネージャーが予約を作ると、履歴・通知・操作履歴も記録される", async () => {
    const id = await create(manager, {});
    const [b] = await sql<{ status: string; occupied: string; source: string }[]>`select status, occupied::text, source from bookings where id = ${id}`;
    expect(b.status).toBe("confirmed");
    // カットは後バッファ10分
    expect(b.occupied).toContain("02:10:00+00"); // 11:10（日本時間）
    const history = await sql`select * from booking_status_history where booking_id = ${id}`;
    expect(history).toHaveLength(1);
    const events = await sql<{ type: string; payload: { customer_name: string } }[]>`select type, payload from notification_events where booking_id = ${id}`;
    expect(events.map((e) => e.type)).toEqual(["booking_confirmed"]);
    expect(events[0].payload.customer_name).toBeTruthy();
    const audit = await sql`select * from audit_logs where target_id = ${id} and action = 'booking.create'`;
    expect(audit).toHaveLength(1);
  });

  it("同じスタッフの重なる予約は作れない", async () => {
    const code = await errorCode(create(manager, { start: at(4, "10:30"), end: at(4, "11:30") }));
    expect(code).toBe("23P01");
  });

  it("スタッフは予約を作れない", async () => {
    expect(await errorCode(create(staffUser, { start: at(5, "10:00"), end: at(5, "11:00") }))).toBe("42501");
  });

  it("サービスを担当していないスタッフ・別店舗のサービスは選べない", async () => {
    expect(await message(create(owner, { staff: salon.spaOnlyStaff, start: at(6, "10:00"), end: at(6, "11:00") }))).toContain("担当していません");
    expect(await message(create(owner, { service: seitai.service, start: at(6, "10:00"), end: at(6, "11:00") }))).toContain("このサービスは選べません");
  });

  it("ほかの企業の利用者は予約を作れない", async () => {
    const [demoOwner] = await sql<{ id: string }[]>`insert into auth.users (is_anonymous) values (true) returning id`;
    expect(await errorCode(create(demoOwner.id, { start: at(7, "10:00"), end: at(7, "11:00") }))).toBe("42501");
  });

  it("設備が必要なサービスは空いている設備を自動で割り当て、すべて埋まると作れない", async () => {
    const base = { loc: seitai.loc, customer: seitai.customer, service: seitai.service, start: at(8, "10:00"), end: at(8, "11:00") };
    const a = await create(owner, { ...base, staff: seitai.staff[0] });
    const b = await create(owner, { ...base, staff: seitai.staff[1] });
    const rows = await sql<{ resource_id: string }[]>`select resource_id from booking_resources where booking_id in (${a}, ${b})`;
    expect(new Set(rows.map((r) => r.resource_id)).size).toBe(2);
    // ベッドは2台なので、3人目のスタッフでも作れない
    expect(await message(create(owner, { ...base, staff: seitai.staff[2] }))).toContain("設備が空いていません");
    // 設備の要らないサービスなら作れる
    await expect(create(owner, { ...base, service: seitai.noResourceService, staff: seitai.staff[0], start: at(8, "12:00"), end: at(8, "12:30") })).resolves.toBeTypeOf("string");
  });
});

describe("予約の変更", () => {
  it("日時を変更すると版が上がり、変更の通知が作られる", async () => {
    const id = await create(owner, { start: at(11, "10:00"), end: at(11, "11:00") });
    const v = await version(id);
    const [{ v: next }] = await as(sql, manager, (tx) => tx<{ v: number }[]>`
      select public.update_booking(${id}, ${v}, ${salon.customer}, ${salon.cut}, ${salon.otherStaff}, ${at(11, "13:00")}, ${at(11, "14:00")}, 5000, 'メモ') v`);
    expect(next).toBe(v + 1);
    const events = await sql<{ type: string }[]>`select type from notification_events where booking_id = ${id} order by created_at`;
    expect(events.map((e) => e.type)).toEqual(["booking_confirmed", "booking_changed"]);
  });

  it("古い版のままでは変更できない（同時編集の検出）", async () => {
    const id = await create(owner, { start: at(12, "10:00"), end: at(12, "11:00") });
    const v = await version(id);
    await as(sql, manager, (tx) => tx`select public.update_booking(${id}, ${v}, ${salon.customer}, ${salon.cut}, ${salon.myStaff}, ${at(12, "10:00")}, ${at(12, "11:00")}, 4950, '1回目')`);
    const msg = await message(as(sql, owner, (tx) => tx`select public.update_booking(${id}, ${v}, ${salon.customer}, ${salon.cut}, ${salon.myStaff}, ${at(12, "15:00")}, ${at(12, "16:00")}, 4950, '2回目')`));
    expect(msg).toContain("ほかの操作で更新されています");
  });

  it("変更先が埋まっていれば変更できない", async () => {
    await create(owner, { start: at(13, "10:00"), end: at(13, "11:00") });
    const id = await create(owner, { start: at(13, "13:00"), end: at(13, "14:00") });
    const v = await version(id);
    const code = await errorCode(as(sql, owner, (tx) => tx`select public.update_booking(${id}, ${v}, ${salon.customer}, ${salon.cut}, ${salon.myStaff}, ${at(13, "10:30")}, ${at(13, "11:30")}, 4950, null)`));
    expect(code).toBe("23P01");
  });

  it("スタッフは予約の内容を変更できない", async () => {
    const id = await create(owner, { start: at(14, "10:00"), end: at(14, "11:00") });
    const code = await errorCode(as(sql, staffUser, (tx) => tx`select public.update_booking(${id}, 1, ${salon.customer}, ${salon.cut}, ${salon.myStaff}, ${at(14, "12:00")}, ${at(14, "13:00")}, 0, null)`));
    expect(code).toBe("42501");
  });
});

describe("ステータスの変更", () => {
  it("キャンセルすると枠が空き、履歴と通知が残る。枠が埋まると予約確定に戻せない", async () => {
    const id = await create(owner, { start: at(18, "10:00"), end: at(18, "11:00") });
    await as(sql, manager, (tx) => tx`select public.set_booking_status(${id}, ${1}, 'cancelled_customer', '体調不良')`);
    const [b] = await sql<{ status: string; cancel_reason: string; cancelled_at: Date | null }[]>`select status, cancel_reason, cancelled_at from bookings where id = ${id}`;
    expect(b).toMatchObject({ status: "cancelled_customer", cancel_reason: "体調不良" });
    expect(b.cancelled_at).not.toBeNull();
    const other = await create(owner, { start: at(18, "10:00"), end: at(18, "11:00") });
    expect(other).toBeTypeOf("string");
    const code = await errorCode(as(sql, manager, (tx) => tx`select public.set_booking_status(${id}, ${2}, 'confirmed')`));
    expect(code).toBe("23P01");
    const types = await sql<{ type: string }[]>`select type from notification_events where booking_id = ${id}`;
    expect(types.map((t) => t.type)).toContain("booking_cancelled");
  });

  it("開始前の予約を来店済み・無断キャンセルにはできない", async () => {
    const id = await create(owner, { start: at(19, "10:00"), end: at(19, "11:00") });
    expect(await message(as(sql, owner, (tx) => tx`select public.set_booking_status(${id}, 1, 'no_show')`))).toContain("開始前");
  });

  it("スタッフは自分の担当予約だけ来店済み・完了にでき、キャンセルはできない", async () => {
    // 過去の予約（開始済み）で試す
    // 3日前の深夜（営業時間外なので見本の予約と重ならない）
    const day = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    const past = (h: string) => new Date(`${day}T0${Number(h) + 2}:00:00+09:00`);
    const mine = await create(owner, { start: past("0"), end: past("1") });
    const others = await create(owner, { staff: salon.otherStaff, start: past("0"), end: past("1") });
    await as(sql, staffUser, (tx) => tx`select public.set_booking_status(${mine}, 1, 'checked_in')`);
    await as(sql, staffUser, (tx) => tx`select public.set_booking_status(${mine}, 2, 'completed')`);
    expect(await message(as(sql, staffUser, (tx) => tx`select public.set_booking_status(${others}, 1, 'checked_in')`))).toContain("見つかりません");
    expect(await errorCode(as(sql, staffUser, (tx) => tx`select public.set_booking_status(${mine}, 3, 'cancelled_store')`))).toBe("42501");
    const history = await sql<{ to_status: string; changed_by: string }[]>`select to_status, changed_by from booking_status_history where booking_id = ${mine} order by created_at`;
    expect(history.map((h) => h.to_status)).toEqual(["confirmed", "checked_in", "completed"]);
    expect(history[2].changed_by).toBe(staffUser);
    await sql`delete from bookings where id in (${mine}, ${others})`;
  });

  it("許可されていない変更（完了→キャンセルなど）はできない", async () => {
    const id = await create(owner, { start: at(20, "10:00"), end: at(20, "11:00"), status: "completed" });
    expect(await message(as(sql, owner, (tx) => tx`select public.set_booking_status(${id}, 1, 'cancelled_customer')`))).toContain("変更できません");
    await sql`delete from bookings where id = ${id}`;
  });
});
