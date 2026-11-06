/** デモデータの性質（仕様の件数・期間・重なりのなさ・偏り） */
import { describe, expect, it } from "vitest";
import { BLUEPRINTS } from "../../src/lib/demo/blueprints";
import { generateDataset } from "../../src/lib/demo/generate";
import { localDate, localMinutes, toMinutes, weekdayOf } from "../../src/lib/time";

const now = new Date("2026-11-05T08:00:00Z");
const blocking = new Set(["confirmed", "checked_in", "completed"]);

describe.each(BLUEPRINTS.map((bp) => [bp.locationName, bp] as const))("%s", (_name, bp) => {
  const data = generateDataset(bp, { now, seed: 42, slug: bp.slug });

  it("件数が仕様の範囲（顧客80〜150・予約300〜600・サービス5〜12・スタッフ3〜6）", () => {
    expect(data.customers.length).toBeGreaterThanOrEqual(80);
    expect(data.customers.length).toBeLessThanOrEqual(150);
    expect(data.bookings.length).toBeGreaterThanOrEqual(300);
    expect(data.bookings.length).toBeLessThanOrEqual(600);
    expect(data.services.length).toBeGreaterThanOrEqual(5);
    expect(data.services.length).toBeLessThanOrEqual(12);
    expect(data.staff.length).toBeGreaterThanOrEqual(3);
    expect(data.staff.length).toBeLessThanOrEqual(6);
  });

  it("過去6か月以上の履歴と、先の予約がある", () => {
    const first = Math.min(...data.bookings.map((b) => b.startsAt.getTime()));
    expect(now.getTime() - first).toBeGreaterThan(180 * 86_400_000);
    expect(data.bookings.some((b) => b.startsAt > now && b.status === "confirmed")).toBe(true);
  });

  it("営業時間内に収まり、同じスタッフ・設備で時間が重ならない", () => {
    const busy = new Map<string, [number, number][]>();
    for (const b of data.bookings) {
      const date = localDate(b.startsAt, "Asia/Tokyo");
      const hours = bp.hours[weekdayOf(date)];
      expect(hours, `${date} は定休日`).toBeDefined();
      expect(localMinutes(b.startsAt, "Asia/Tokyo")).toBeGreaterThanOrEqual(toMinutes(hours![0]));
      expect(localMinutes(b.endsAt, "Asia/Tokyo")).toBeLessThanOrEqual(toMinutes(hours![1]));
      if (!blocking.has(b.status)) continue;
      const range: [number, number] = [b.startsAt.getTime() - b.bufferBefore * 60_000, b.endsAt.getTime() + b.bufferAfter * 60_000];
      for (const key of [b.staffId && `s:${b.staffId}`, b.resourceId && `r:${b.resourceId}`]) {
        if (!key) continue;
        const list = busy.get(key) ?? [];
        expect(list.some(([s, e]) => range[0] < e && s < range[1])).toBe(false);
        list.push(range);
        busy.set(key, list);
      }
    }
  });

  it("過去の予約には完了・無断キャンセル・キャンセルが混在し、先の予約は確定かキャンセル", () => {
    const past = data.bookings.filter((b) => b.endsAt <= now);
    const statuses = new Set(past.map((b) => b.status));
    for (const s of ["completed", "no_show", "cancelled_customer"]) expect(statuses.has(s as never)).toBe(true);
    expect(data.bookings.filter((b) => b.startsAt > now).every((b) => b.status === "confirmed" || b.status === "cancelled_customer")).toBe(true);
  });

  it("新規とリピーターが混在する", () => {
    const visits = new Map<string, number>();
    for (const b of data.bookings.filter((x) => x.status === "completed")) visits.set(b.customerId, (visits.get(b.customerId) ?? 0) + 1);
    const once = [...visits.values()].filter((v) => v === 1).length;
    const repeat = [...visits.values()].filter((v) => v >= 2).length;
    expect(once).toBeGreaterThanOrEqual(3);
    expect(repeat).toBeGreaterThan(once / 2);
  });

  it("顧客の登録日は初回の予約の受付以前", () => {
    const first = new Map<string, number>();
    for (const b of data.bookings) first.set(b.customerId, Math.min(first.get(b.customerId) ?? Infinity, b.createdAt.getTime()));
    for (const c of data.customers) if (first.has(c.id)) expect(c.createdAt.getTime()).toBeLessThanOrEqual(first.get(c.id)!);
  });
});
