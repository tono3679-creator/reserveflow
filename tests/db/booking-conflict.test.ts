/**
 * 予約の競合防止（DB の排他制約）。
 * 画面やサーバーの判定をすり抜けても、同じスタッフ・設備の占有時間が重なる予約は DB が拒否する。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { rebuildShowcase } from "../../src/lib/demo/showcase";
import { connect, errorCode } from "../helpers/db";

let sql: Sql;
let ctx: { org: string; loc: string; staff: string; customer: string; service: string; resource: string; seitaiOrg: string; seitaiLoc: string; seitaiService: string; seitaiCustomer: string };
// 予約の入っていない遠い将来の日付で試す
const at = (hhmm: string) => new Date(`2030-01-08T${hhmm}:00+09:00`);

async function insertBooking(o: { org?: string; loc?: string; staff?: string | null; start: string; end: string; status?: string; before?: number; after?: number; service?: string; customer?: string }) {
  const [row] = await sql<{ id: string }[]>`
    insert into bookings (organization_id, location_id, customer_id, service_id, staff_id, starts_at, ends_at,
                          buffer_before_minutes, buffer_after_minutes, occupied, price, status)
    values (${o.org ?? ctx.org}, ${o.loc ?? ctx.loc}, ${o.customer ?? ctx.customer}, ${o.service ?? ctx.service},
            ${o.staff === undefined ? ctx.staff : o.staff}, ${at(o.start)}, ${at(o.end)}, ${o.before ?? 0}, ${o.after ?? 0},
            '[2000-01-01,2000-01-02)', 1000, ${o.status ?? "confirmed"})
    returning id`;
  return row.id;
}

beforeAll(async () => {
  sql = connect();
  await rebuildShowcase(sql);
  const [salon] = await sql<{ org: string; loc: string }[]>`select organization_id org, id loc from locations where slug = 'demo-salon'`;
  const [seitai] = await sql<{ org: string; loc: string }[]>`select organization_id org, id loc from locations where slug = 'demo-seitai'`;
  const [staff] = await sql<{ id: string }[]>`select id from staff where location_id = ${salon.loc} order by sort_order limit 1`;
  const [customer] = await sql<{ id: string }[]>`select id from customers where organization_id = ${salon.org} limit 1`;
  const [service] = await sql<{ id: string }[]>`select id from services where location_id = ${salon.loc} limit 1`;
  const [seitaiService] = await sql<{ id: string }[]>`select s.id from services s join service_resources sr on sr.service_id = s.id where s.location_id = ${seitai.loc} limit 1`;
  const [resource] = await sql<{ id: string }[]>`select id from resources where location_id = ${seitai.loc} order by sort_order limit 1`;
  const [seitaiCustomer] = await sql<{ id: string }[]>`select id from customers where organization_id = ${seitai.org} limit 1`;
  ctx = { org: salon.org, loc: salon.loc, staff: staff.id, customer: customer.id, service: service.id, resource: resource.id,
    seitaiOrg: seitai.org, seitaiLoc: seitai.loc, seitaiService: seitaiService.id, seitaiCustomer: seitaiCustomer.id };
});

afterAll(async () => {
  await sql`delete from bookings where starts_at >= '2030-01-01'`;
  await sql.end();
});

describe("スタッフの重複予約", () => {
  it("同じスタッフの時間が重なる予約は拒否される", async () => {
    await insertBooking({ start: "10:00", end: "11:00" });
    expect(await errorCode(insertBooking({ start: "10:30", end: "11:30" }))).toBe("23P01");
  });

  it("終了時刻ちょうどに始まる予約は重ならない（半開区間）", async () => {
    await expect(insertBooking({ start: "11:00", end: "11:30" })).resolves.toBeTypeOf("string");
  });

  it("前後のバッファ時間も占有時間に含める", async () => {
    await insertBooking({ start: "13:00", end: "14:00", after: 15 });
    expect(await errorCode(insertBooking({ start: "14:00", end: "14:30" }))).toBe("23P01");
    await expect(insertBooking({ start: "14:15", end: "14:45" })).resolves.toBeTypeOf("string");
  });

  it("キャンセル・無断キャンセルの予約は枠を占有しない", async () => {
    await insertBooking({ start: "16:00", end: "17:00", status: "cancelled_customer" });
    await insertBooking({ start: "16:00", end: "17:00", status: "no_show" });
    await expect(insertBooking({ start: "16:00", end: "17:00" })).resolves.toBeTypeOf("string");
  });

  it("キャンセルした予約を元に戻すとき、枠が埋まっていれば拒否される", async () => {
    const cancelled = await insertBooking({ start: "18:00", end: "19:00", status: "cancelled_store" });
    await insertBooking({ start: "18:30", end: "19:30" });
    expect(await errorCode(sql`update bookings set status = 'confirmed' where id = ${cancelled}`)).toBe("23P01");
  });

  it("時間を変更して重なる場合も拒否される", async () => {
    const id = await insertBooking({ start: "08:00", end: "08:30" });
    expect(await errorCode(sql`update bookings set starts_at = ${at("10:15")}, ends_at = ${at("10:45")} where id = ${id}`)).toBe("23P01");
  });

  it("担当者なしの予約同士は重なってよい（スタッフの制約は担当者がいるときだけ）", async () => {
    await insertBooking({ start: "20:00", end: "21:00", staff: null });
    await expect(insertBooking({ start: "20:00", end: "21:00", staff: null })).resolves.toBeTypeOf("string");
  });

  it("同時に2つのトランザクションが同じ枠を取ろうとしても、片方だけが成功する", async () => {
    const attempt = () => sql.begin(async (tx) => {
      await tx`insert into bookings (organization_id, location_id, customer_id, service_id, staff_id, starts_at, ends_at, occupied, price)
        values (${ctx.org}, ${ctx.loc}, ${ctx.customer}, ${ctx.service}, ${ctx.staff}, ${new Date("2030-01-09T10:00:00+09:00")},
                ${new Date("2030-01-09T11:00:00+09:00")}, '[2000-01-01,2000-01-02)', 1000)`;
      await tx`select pg_sleep(0.2)`;
    });
    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as { code: string }).code).toBe("23P01");
  });
});

describe("設備の重複予約", () => {
  async function useResource(bookingId: string) {
    const [b] = await sql<{ occupied: string; status: string }[]>`select occupied::text, status from bookings where id = ${bookingId}`;
    await sql`insert into booking_resources (organization_id, booking_id, resource_id, occupied, is_active)
      values (${ctx.seitaiOrg}, ${bookingId}, ${ctx.resource}, ${b.occupied}::tstzrange, booking_blocks_slot(${b.status}::booking_status))`;
  }
  const seitai = { org: undefined as string | undefined, staff: null };

  it("同じ設備の時間が重なる予約は拒否される", async () => {
    Object.assign(seitai, { org: ctx.seitaiOrg });
    const a = await insertBooking({ ...seitai, loc: ctx.seitaiLoc, service: ctx.seitaiService, customer: ctx.seitaiCustomer, start: "10:00", end: "11:00" });
    await useResource(a);
    const b = await insertBooking({ ...seitai, loc: ctx.seitaiLoc, service: ctx.seitaiService, customer: ctx.seitaiCustomer, start: "10:30", end: "11:30" });
    expect(await errorCode(useResource(b))).toBe("23P01");
  });

  it("予約をキャンセルすると設備も解放され、時間の変更にも追従する", async () => {
    const a = await insertBooking({ ...seitai, loc: ctx.seitaiLoc, service: ctx.seitaiService, customer: ctx.seitaiCustomer, start: "14:00", end: "15:00" });
    await useResource(a);
    await sql`update bookings set status = 'cancelled_customer' where id = ${a}`;
    const [r] = await sql<{ is_active: boolean }[]>`select is_active from booking_resources where booking_id = ${a}`;
    expect(r.is_active).toBe(false);
    const b = await insertBooking({ ...seitai, loc: ctx.seitaiLoc, service: ctx.seitaiService, customer: ctx.seitaiCustomer, start: "14:00", end: "15:00" });
    await useResource(b);
    await sql`update bookings set starts_at = ${at("16:00")}, ends_at = ${at("17:00")} where id = ${b}`;
    const [moved] = await sql<{ lower: Date }[]>`select lower(occupied) from booking_resources where booking_id = ${b}`;
    expect(moved.lower.toISOString()).toBe(at("16:00").toISOString());
  });
});

describe("テナントをまたぐ参照", () => {
  it("別の企業の顧客・スタッフを使った予約は作れない", async () => {
    expect(await errorCode(insertBooking({ start: "07:00", end: "07:30", customer: ctx.seitaiCustomer }))).toBe("23503");
    const [foreignStaff] = await sql<{ id: string }[]>`select id from staff where location_id = ${ctx.seitaiLoc} limit 1`;
    expect(await errorCode(insertBooking({ start: "07:00", end: "07:30", staff: foreignStaff.id }))).toBe("23503");
  });
});
