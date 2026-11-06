/**
 * 分析の集計（SQL）の定義を、小さな予約データで確かめる。
 * 見本の美容室の、ほかのテストと重ならない 2033 年に予約を入れる（担当なし）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { byGroup, noShowCustomers, repeatSummary, returnCohorts, summary, visitCountDistribution, daysToReturnDistribution, monthly } from "../../src/lib/analytics/metrics";
import { periodRange } from "../../src/lib/analytics/period";
import { rebuildShowcase } from "../../src/lib/demo/showcase";
import { as, connect } from "../helpers/db";

let sql: Sql;
let owner: string, staffUser: string;
let org: string, loc: string, service: string;
const TZ = "Asia/Tokyo";
const MARCH = periodRange({ from: "2033-03-01", to: "2033-03-31" }, TZ);
const NOW = new Date("2033-03-20T12:00:00+09:00");
let hourOffset = 0;

async function customer(name: string, bookings: { date: string; status: string; price: number }[]) {
  const [c] = await sql<{ id: string }[]>`insert into customers (organization_id, name) values (${org}, ${name}) returning id`;
  for (const b of bookings) {
    const start = new Date(`${b.date}T10:00:00+09:00`);
    start.setUTCMinutes(start.getUTCMinutes() + (hourOffset++ % 4) * 60);
    await sql`insert into bookings (organization_id, location_id, customer_id, service_id, staff_id, starts_at, ends_at, occupied, price, status)
      values (${org}, ${loc}, ${c.id}, ${service}, null, ${start}, ${new Date(start.getTime() + 3_600_000)}, '[2000-01-01,2000-01-02)', ${b.price}, ${b.status})`;
  }
  return c.id;
}

beforeAll(async () => {
  sql = connect();
  await rebuildShowcase(sql);
  const users = await sql<{ id: string; email: string }[]>`select id, email from auth.users where email like '%@reserveflow.example'`;
  owner = users.find((u) => u.email.startsWith("owner"))!.id;
  staffUser = users.find((u) => u.email.startsWith("staff"))!.id;
  [{ org, loc }] = await sql<{ org: string; loc: string }[]>`select organization_id org, id loc from locations where slug = 'demo-salon'`;
  [{ id: service }] = await sql<{ id: string }[]>`select id from services where location_id = ${loc} and name = 'カット'`;
  await customer("分析A", [
    { date: "2033-01-10", status: "completed", price: 5000 },
    { date: "2033-03-05", status: "completed", price: 5000 },
    { date: "2033-03-25", status: "confirmed", price: 5000 }, // 将来の予約（無断キャンセル率の母数に入れない）
  ]);
  await customer("分析B", [
    { date: "2033-03-06", status: "completed", price: 3000 },
    { date: "2033-03-07", status: "no_show", price: 4000 },
  ]);
  await customer("分析C", [
    { date: "2033-03-08", status: "cancelled_customer", price: 2000 },
    { date: "2033-03-09", status: "cancelled_store", price: 2000 }, // 店舗都合（母数に入れない）
  ]);
  await customer("分析D", [
    { date: "2033-03-10", status: "completed", price: 6000 },
    { date: "2033-03-15", status: "checked_in", price: 6000 },
  ]);
});

afterAll(async () => {
  await sql.end();
});

describe("予約・売上・無断キャンセル", () => {
  it("予約件数はキャンセルを除き、売上と平均客単価は来店分だけで計算する", async () => {
    const s = await as(sql, owner, (tx) => summary(tx, loc, MARCH, NOW));
    expect(s).toMatchObject({ bookings: 6, visits: 4, sales: 20000, avgPrice: 5000 });
    expect(s.statusCounts).toMatchObject({ completed: 3, checked_in: 1, confirmed: 1, no_show: 1, cancelled_customer: 1, cancelled_store: 1 });
  });

  it("無断キャンセル率の母数は、いまより前に始まる予約から店舗キャンセルを除いたもの", async () => {
    const { noShow } = await as(sql, owner, (tx) => summary(tx, loc, MARCH, NOW));
    expect(noShow).toMatchObject({ target: 6, noShows: 1, customerCancels: 1, lostAmount: 4000 });
    expect(noShow.noShowRate).toBeCloseTo(1 / 6);
    expect(noShow.customerCancelRate).toBeCloseTo(1 / 6);
  });

  it("母数が 0 なら率は計算しない（null）", async () => {
    const empty = periodRange({ from: "2033-02-01", to: "2033-02-28" }, TZ);
    const s = await as(sql, owner, (tx) => summary(tx, loc, empty, NOW));
    expect(s.noShow.noShowRate).toBeNull();
    expect(s.avgPrice).toBeNull();
  });

  it("無断キャンセルの多い顧客とサービス別の集計", async () => {
    const [list, services] = await as(sql, owner, (tx) => Promise.all([noShowCustomers(tx, loc, MARCH, NOW), byGroup(tx, loc, MARCH, "service", NOW)]));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "分析B", noShows: 1, target: 2 });
    const cut = services.find((s) => s.id === service)!;
    expect(cut).toMatchObject({ bookings: 6, visits: 4, sales: 20000, visitors: 3, repeaters: 2 });
  });
});

describe("リピート率", () => {
  it("期間に来店した顧客のうち、期間の終わりまでの累計来店が2回以上の割合（顧客は重複して数えない）", async () => {
    const r = await as(sql, owner, (tx) => repeatSummary(tx, loc, MARCH));
    // 来店：A（1月にも来店）・B（初回）・D（初回＋2回目）
    expect(r).toMatchObject({ visitors: 3, repeaters: 2, newCustomers: 2, visits: 4 });
    expect(r.repeatRate).toBeCloseTo(2 / 3);
    expect(r.avgVisits).toBeCloseTo(4 / 3);
    // 前回からの日数：A 54日、D 5日
    expect(r.avgIntervalDays).toBeCloseTo(29.5, 1);
    expect(r.intervalSamples).toBe(2);
  });

  it("再来店率は初回から N 日たった顧客だけを母数にする（観測中の顧客は除く）", async () => {
    const early = await as(sql, owner, (tx) => returnCohorts(tx, loc, MARCH, NOW));
    expect(early.find((c) => c.days === 30)).toMatchObject({ cohort: 2, eligible: 0, rate: null });
    const later = await as(sql, owner, (tx) => returnCohorts(tx, loc, MARCH, new Date("2033-05-01T12:00:00+09:00")));
    // B（初回 3/6、再来店なし）と D（初回 3/10、5日後に再来店）が 30 日の母数。60 日はまだ観測中
    expect(later.find((c) => c.days === 30)).toMatchObject({ cohort: 2, eligible: 2, returned: 1, rate: 0.5 });
    expect(later.find((c) => c.days === 60)).toMatchObject({ eligible: 0, rate: null });
  });

  it("来店回数と再来店までの日数の分布、月ごとの新規・リピーター", async () => {
    const [counts, days, months] = await as(sql, owner, (tx) => Promise.all([
      visitCountDistribution(tx, loc, MARCH), daysToReturnDistribution(tx, loc, MARCH), monthly(tx, loc, TZ, 3, NOW),
    ]));
    expect(counts.find((c) => c.label === "1回")!.count).toBe(1);
    expect(counts.find((c) => c.label === "2回")!.count).toBe(2);
    expect(days.find((d) => d.label === "14日以内")!.count).toBe(1);
    expect(days.find((d) => d.label === "まだ再来店なし")!.count).toBe(1);
    const march = months.find((m) => m.month === "2033-03")!;
    expect(march).toMatchObject({ visitors: 3, newCustomers: 2, repeaters: 2, sales: 20000 });
    expect(months.find((m) => m.month === "2033-01")).toMatchObject({ visitors: 1, newCustomers: 1, repeaters: 0 });
  });
});

describe("権限", () => {
  it("スタッフの立場では他人の担当の予約が見えないので集計に入らない（RLS）", async () => {
    const s = await as(sql, staffUser, (tx) => summary(tx, loc, MARCH, NOW));
    expect(s.bookings).toBe(0);
  });
});
