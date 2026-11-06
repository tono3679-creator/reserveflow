/**
 * 顧客の集計とセグメント（SQL）と、スタッフの実績の集計。
 * 見本の美容室に専用の顧客を作り、予約を直接入れて判定を確かめる（「今」は 2030-06-01 に固定）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { getCustomerDetail, getSegmentRules, listCustomers } from "../../src/lib/data/customers";
import { listStaff } from "../../src/lib/data/staff";
import { rebuildShowcase } from "../../src/lib/demo/showcase";
import { as, connect } from "../helpers/db";

let sql: Sql;
let owner: string, staffUser: string;
let org: string, loc: string, service: string;
const NOW = new Date("2030-06-01T12:00:00+09:00");
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
let slot = 0;

async function customerWith(name: string, bookings: { daysAgo: number; status: string; price?: number }[]) {
  const [c] = await sql<{ id: string }[]>`insert into customers (organization_id, name) values (${org}, ${name}) returning id`;
  for (const b of bookings) {
    // 同じ時刻にならないよう、予約ごとに1時間ずらす（担当なし）
    const start = new Date(daysBefore(b.daysAgo).getTime() + (slot++ % 8) * 3_600_000);
    await sql`insert into bookings (organization_id, location_id, customer_id, service_id, staff_id, starts_at, ends_at, occupied, price, status)
      values (${org}, ${loc}, ${c.id}, ${service}, null, ${start}, ${new Date(start.getTime() + 3_600_000)}, '[2000-01-01,2000-01-02)', ${b.price ?? 5000}, ${b.status})`;
  }
  return c.id;
}

async function segmentOf(name: string) {
  return as(sql, owner, async (tx) => {
    const rules = await getSegmentRules(tx, loc);
    const r = await listCustomers(tx, org, loc, rules, { q: name, sort: "name", dir: "asc", page: 1, pageSize: 10 }, NOW);
    expect(r.rows).toHaveLength(1);
    return r.rows[0];
  });
}

beforeAll(async () => {
  sql = connect();
  await rebuildShowcase(sql);
  const users = await sql<{ id: string; email: string }[]>`select id, email from auth.users where email like '%@reserveflow.example'`;
  owner = users.find((u) => u.email.startsWith("owner"))!.id;
  staffUser = users.find((u) => u.email.startsWith("staff"))!.id;
  const [l] = await sql<{ org: string; loc: string }[]>`select organization_id org, id loc from locations where slug = 'demo-salon'`;
  org = l.org;
  loc = l.loc;
  [{ id: service }] = await sql<{ id: string }[]>`select id from services where location_id = ${loc} and name = 'カット'`;
  // 判定の基準：リピーター2回・VIP 6回かつ5万円・休眠90日（既定値）
  await sql`update tenant_settings set segment_repeat_min_visits = 2, segment_vip_min_visits = 6, segment_vip_min_spend = 50000, segment_dormant_days = 90 where location_id = ${loc}`;
});

afterAll(async () => {
  await sql.end();
});

describe("顧客セグメント", () => {
  it("来店がなければ未来店、1回なら新規", async () => {
    await customerWith("セグ未来店", [{ daysAgo: 5, status: "cancelled_customer" }, { daysAgo: 3, status: "no_show" }]);
    await customerWith("セグ新規", [{ daysAgo: 10, status: "completed" }]);
    const p = await segmentOf("セグ未来店");
    expect(p).toMatchObject({ segment: "prospect", visits: 0, noShows: 1, cancellations: 1, totalBookings: 2 });
    expect((await segmentOf("セグ新規")).segment).toBe("new");
  });

  it("来店回数がリピーターの基準以上ならリピーター、回数と金額が VIP の基準以上なら VIP", async () => {
    await customerWith("セグリピーター", [{ daysAgo: 40, status: "completed" }, { daysAgo: 10, status: "checked_in" }]);
    await customerWith("セグVIP", Array.from({ length: 6 }, (_, i) => ({ daysAgo: 10 + i * 20, status: "completed", price: 9000 })));
    await customerWith("セグ回数だけ", Array.from({ length: 6 }, (_, i) => ({ daysAgo: 10 + i * 20, status: "completed", price: 3000 })));
    expect((await segmentOf("セグリピーター")).segment).toBe("repeat");
    const vip = await segmentOf("セグVIP");
    expect(vip).toMatchObject({ segment: "vip", visits: 6, spend: 54000 });
    expect((await segmentOf("セグ回数だけ")).segment).toBe("repeat");
  });

  it("最後の来店から休眠の日数がたち、今後の予約がなければ休眠（予約があれば休眠にしない）", async () => {
    await customerWith("セグ休眠", [{ daysAgo: 300, status: "completed" }, { daysAgo: 200, status: "completed" }]);
    await customerWith("セグ復帰予定", [{ daysAgo: 300, status: "completed" }, { daysAgo: 200, status: "completed" }, { daysAgo: -7, status: "confirmed" }]);
    expect((await segmentOf("セグ休眠")).segment).toBe("dormant");
    const back = await segmentOf("セグ復帰予定");
    expect(back.segment).toBe("repeat");
    expect(back.nextBooking).not.toBeNull();
  });

  it("基準は店舗設定で変えられる", async () => {
    await sql`update tenant_settings set segment_repeat_min_visits = 3 where location_id = ${loc}`;
    expect((await segmentOf("セグリピーター")).segment).toBe("new");
    await sql`update tenant_settings set segment_repeat_min_visits = 2 where location_id = ${loc}`;
  });

  it("セグメントで絞り込むと件数が合う", async () => {
    await as(sql, owner, async (tx) => {
      const rules = await getSegmentRules(tx, loc);
      const all = await listCustomers(tx, org, loc, rules, { q: "セグ", sort: "name", dir: "asc", page: 1, pageSize: 50 }, NOW);
      const vip = await listCustomers(tx, org, loc, rules, { q: "セグ", segment: "vip", sort: "name", dir: "asc", page: 1, pageSize: 50 }, NOW);
      expect(all.total).toBe(7);
      expect(vip.total).toBe(all.segmentCounts.vip);
      expect(vip.rows.map((r) => r.name)).toEqual(["セグVIP"]);
    });
  });

  it("顧客の詳細：平均来店間隔とよく利用するサービス", async () => {
    const id = await customerWith("セグ間隔", [{ daysAgo: 60, status: "completed" }, { daysAgo: 30, status: "completed" }, { daysAgo: 0.5, status: "completed" }]);
    await as(sql, owner, async (tx) => {
      const d = await getCustomerDetail(tx, org, loc, id, await getSegmentRules(tx, loc), null, NOW);
      expect(d?.visits).toBe(3);
      expect(d?.averageIntervalDays).toBeGreaterThanOrEqual(29);
      expect(d?.averageIntervalDays).toBeLessThanOrEqual(30);
      expect(d?.favoriteService).toBe("カット");
    });
  });

  it("スタッフの立場では担当していない顧客は一覧に出ない（RLS）", async () => {
    await as(sql, staffUser, async (tx) => {
      const rules = await getSegmentRules(tx, loc);
      const r = await listCustomers(tx, org, loc, rules, { q: "セグ", sort: "name", dir: "asc", page: 1, pageSize: 50 }, NOW);
      expect(r.total).toBe(0);
    });
  });
});

describe("スタッフの実績", () => {
  it("勤務時間は休憩を除いて数え、稼働率 = 予約時間 ÷ 勤務時間", async () => {
    const rows = await as(sql, owner, (tx) => listStaff(tx, loc, "Asia/Tokyo"));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows.filter((x) => x.isActive)) {
      expect(r.stats).not.toBeNull();
      expect(r.stats!.workingMinutes).toBeGreaterThan(0);
      expect(r.stats!.utilization).toBeCloseTo(r.stats!.bookedMinutes / r.stats!.workingMinutes, 6);
      expect(r.stats!.utilization!).toBeLessThanOrEqual(1);
    }
  });
});
