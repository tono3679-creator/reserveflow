/**
 * テナント分離と役割ごとの権限（RLS）。
 * 見本の企業（4社）と、デモ訪問者の企業（4社）の2つの利用者グループを作り、互いのデータに触れないことを確かめる。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { createDemoEnvironment, demoSessionOf } from "../../src/lib/demo/create";
import { rebuildShowcase } from "../../src/lib/demo/showcase";
import { as, asAnon, connect, errorCode } from "../helpers/db";

let sql: Sql;
let showcaseOwner: string;
let showcaseManager: string;
let showcaseStaff: string;
let demo: { id: string; owner: string; manager: string; staff: string };
let salonOrg: string; // 見本の美容室
let demoSalonOrg: string; // デモ訪問者の美容室

beforeAll(async () => {
  sql = connect();
  await rebuildShowcase(sql, { password: "test-password-123" });
  const users = await sql<{ id: string; email: string }[]>`select id, email from auth.users where email like '%@reserveflow.example'`;
  showcaseOwner = users.find((u) => u.email.startsWith("owner"))!.id;
  showcaseManager = users.find((u) => u.email.startsWith("manager"))!.id;
  showcaseStaff = users.find((u) => u.email.startsWith("staff"))!.id;
  const env = await createDemoEnvironment(sql);
  demo = (await demoSessionOf(sql, env.ownerUserId))!;
  [{ id: salonOrg }] = await sql`select o.id from organizations o join locations l on l.organization_id = o.id where l.slug = 'demo-salon'`;
  [{ id: demoSalonOrg }] = await sql`select o.id from organizations o join locations l on l.organization_id = o.id
    where o.demo_session_id = ${demo.id} and l.industry = 'beauty_salon'`;
});

afterAll(async () => {
  await sql.end();
});

describe("テナント分離", () => {
  it("デモ訪問者のオーナーには、自分の4社だけが見える", async () => {
    const orgs = await as(sql, demo.owner, (tx) => tx<{ id: string; demo_session_id: string | null }[]>`select id, demo_session_id from organizations`);
    expect(orgs).toHaveLength(4);
    expect(orgs.every((o) => o.demo_session_id === demo.id)).toBe(true);
  });

  it("ほかの企業の予約・顧客・スタッフ・サービスは1件も返らない", async () => {
    const counts = await as(sql, demo.owner, (tx) => tx<{ bookings: number; customers: number; staff: number; services: number }[]>`
      select (select count(*)::int from bookings where organization_id = ${salonOrg}) bookings,
             (select count(*)::int from customers where organization_id = ${salonOrg}) customers,
             (select count(*)::int from staff where organization_id = ${salonOrg}) staff,
             (select count(*)::int from services where organization_id = ${salonOrg}) services`);
    expect(counts[0]).toEqual({ bookings: 0, customers: 0, staff: 0, services: 0 });
    // 見本のオーナーからは、デモ訪問者の企業が見えない
    const [other] = await as(sql, showcaseOwner, (tx) => tx<{ n: number }[]>`select count(*)::int n from customers where organization_id = ${demoSalonOrg}`);
    expect(other.n).toBe(0);
  });

  it("ほかの企業のデータは ID を指定しても更新・削除できない", async () => {
    const updated = await as(sql, demo.owner, (tx) => tx`update customers set name = '書き換え' where organization_id = ${salonOrg} returning id`);
    expect(updated).toHaveLength(0);
    const deleted = await as(sql, demo.owner, (tx) => tx`delete from services where organization_id = ${salonOrg} returning id`);
    expect(deleted).toHaveLength(0);
  });

  it("ほかの企業に顧客を登録できない", async () => {
    const code = await errorCode(as(sql, demo.owner, (tx) => tx`insert into customers (organization_id, name) values (${salonOrg}, '侵入')`));
    expect(code).toBe("42501");
  });

  it("自分の企業の行から、ほかの企業のスタッフ・顧客を参照できない（複合外部キー）", async () => {
    const [foreignStaff] = await sql<{ id: string }[]>`select id from staff where organization_id = ${salonOrg} limit 1`;
    // RLS を通らない所有者の接続でも、企業をまたぐ参照は外部キーが拒否する
    const code = await errorCode(sql`insert into customers (organization_id, name, preferred_staff_id) values (${demoSalonOrg}, 'テスト', ${foreignStaff.id})`);
    expect(code).toBe("23503");
  });

  it("未ログイン（anon）はどのテーブルも読めない", async () => {
    for (const table of ["organizations", "customers", "bookings", "staff", "services"]) {
      const code = await errorCode(asAnon(sql, (tx) => tx`select count(*) from ${tx(table)}`));
      expect(code, table).toBe("42501");
    }
  });

  it("ログイン利用者はアプリ内部の表（セッション・デモ訪問者）を読めない", async () => {
    const code = await errorCode(as(sql, demo.owner, (tx) => tx`select * from app_private.sessions`));
    expect(code).toBe("42501");
  });
});

describe("役割ごとの権限", () => {
  it("スタッフには自分が担当する予約だけが見える", async () => {
    const rows = await as(sql, showcaseStaff, (tx) => tx<{ staff_id: string | null }[]>`
      select b.staff_id from bookings b where b.organization_id = ${salonOrg}`);
    const [mine] = await sql<{ id: string }[]>`
      select s.id from staff s join organization_members m on m.id = s.member_id where m.user_id = ${showcaseStaff}`;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.staff_id === mine.id)).toBe(true);
    const [all] = await sql<{ n: number }[]>`select count(*)::int n from bookings where organization_id = ${salonOrg}`;
    expect(rows.length).toBeLessThan(all.n);
  });

  it("スタッフには担当した顧客だけが見え、顧客情報は変更できない", async () => {
    const visible = await as(sql, showcaseStaff, (tx) => tx<{ id: string }[]>`select id from customers where organization_id = ${salonOrg}`);
    const [all] = await sql<{ n: number }[]>`select count(*)::int n from customers where organization_id = ${salonOrg}`;
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(all.n);
    const updated = await as(sql, showcaseStaff, (tx) => tx`update customers set name = '変更' where id = ${visible[0].id} returning id`);
    expect(updated).toHaveLength(0);
  });

  it("マネージャーは顧客を変更できるが、サービス・店舗設定は変更できない", async () => {
    const customers = await as(sql, showcaseManager, (tx) => tx`
      update customers set name_kana = name_kana where id = (select id from customers where organization_id = ${salonOrg} limit 1) returning id`);
    expect(customers).toHaveLength(1);
    const services = await as(sql, showcaseManager, (tx) => tx`update services set price = 1 where organization_id = ${salonOrg} returning id`);
    expect(services).toHaveLength(0);
    const settings = await as(sql, showcaseManager, (tx) => tx`update tenant_settings set max_advance_days = 10 where organization_id = ${salonOrg} returning 1`);
    expect(settings).toHaveLength(0);
  });

  it("マネージャーはスタッフの勤務時間を変更できる", async () => {
    const rows = await as(sql, showcaseManager, (tx) => tx`
      update staff_schedules set ends_at = ends_at where organization_id = ${salonOrg} returning id`);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("オーナーはサービスと店舗設定を変更できる", async () => {
    const rows = await as(sql, showcaseOwner, (tx) => tx`update tenant_settings set max_advance_days = 60 where organization_id = ${salonOrg} returning 1`);
    expect(rows).toHaveLength(1);
  });

  it("予約はどの役割でも直接書き換えられない（DB 関数だけが書き込む）", async () => {
    for (const user of [showcaseOwner, showcaseManager, showcaseStaff]) {
      const code = await errorCode(as(sql, user, (tx) => tx`update bookings set price = 0 where organization_id = ${salonOrg}`));
      expect(code).toBe("42501");
    }
  });

  it("操作履歴はオーナーだけが読める", async () => {
    await as(sql, showcaseOwner, (tx) => tx`select public.write_audit_log(${salonOrg}, 'test', 'location', null, '{}'::jsonb)`);
    const owner = await as(sql, showcaseOwner, (tx) => tx`select id from audit_logs where organization_id = ${salonOrg}`);
    const manager = await as(sql, showcaseManager, (tx) => tx`select id from audit_logs where organization_id = ${salonOrg}`);
    expect(owner.length).toBeGreaterThan(0);
    expect(manager).toHaveLength(0);
    // 所属していない企業には記録できない
    const code = await errorCode(as(sql, demo.owner, (tx) => tx`select public.write_audit_log(${salonOrg}, 'x', 'location', null, '{}'::jsonb)`));
    expect(code).toBe("42501");
  });
});
