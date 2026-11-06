/** 空き枠エンジン：営業時間・勤務時間・休憩・休暇・既存予約・バッファ・設備・受付期限 */
import { describe, expect, it } from "vitest";
import { checkSlot, openSlots } from "../../src/lib/scheduling/engine";
import type { SchedulingContext, ServiceSpec } from "../../src/lib/scheduling/types";
import { zonedDateTime } from "../../src/lib/time";

const TZ = "Asia/Tokyo";
const t = (date: string, hhmm: string) => zonedDateTime(date, hhmm, TZ).getTime();
// 2030-03-05 は火曜日、2030-03-04 は月曜日（定休日）
const DAY = "2030-03-05";
const NOW = t("2030-03-01", "09:00");

function ctx(overrides: Partial<SchedulingContext> = {}): SchedulingContext {
  return {
    timezone: TZ, slotIntervalMinutes: 30, minLeadMinutes: 60, maxAdvanceDays: 60, staffSelection: "optional",
    businessHours: [2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "10:00", closes: "19:00" })),
    exceptions: [],
    staff: [
      { id: "a", name: "佐藤", schedules: [{ weekday: 2, start: "10:00", end: "19:00", breakStart: "13:00", breakEnd: "14:00" }], timeOff: [] },
      { id: "b", name: "高橋", schedules: [{ weekday: 2, start: "12:00", end: "19:00" }], timeOff: [] },
    ],
    resources: [{ id: "bed1", name: "ベッド1" }],
    bookings: [],
    ...overrides,
  };
}
const cut: ServiceSpec = { id: "cut", name: "カット", durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 10, staffIds: ["a", "b"], resourceIds: [] };
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe("スタッフ勤務時間の判定（checkSlot）", () => {
  it("勤務時間内で空いていれば問題なし", () => {
    expect(checkSlot(ctx(), cut, { staffId: "a", start: t(DAY, "10:00"), end: t(DAY, "11:00") })).toEqual([]);
  });
  it("休憩と重なる・勤務時間外・勤務のない日・休暇を判定する", () => {
    expect(codes(checkSlot(ctx(), cut, { staffId: "a", start: t(DAY, "12:30"), end: t(DAY, "13:30") }))).toEqual(["staff_break"]);
    expect(codes(checkSlot(ctx(), cut, { staffId: "b", start: t(DAY, "10:00"), end: t(DAY, "11:00") }))).toEqual(["staff_outside_hours"]);
    expect(codes(checkSlot(ctx(), cut, { staffId: "a", start: t("2030-03-06", "10:00"), end: t("2030-03-06", "11:00") }))).toEqual(["staff_outside_hours"]);
    const off = ctx({ staff: [{ ...ctx().staff[0], timeOff: [{ date: DAY, kind: "day_off" }] }] });
    expect(codes(checkSlot(off, cut, { staffId: "a", start: t(DAY, "10:00"), end: t(DAY, "11:00") }))).toEqual(["staff_day_off"]);
  });
  it("特定日の勤務時間の変更は、曜日の基本勤務より優先する", () => {
    const custom = ctx({ staff: [{ ...ctx().staff[0], timeOff: [{ date: DAY, kind: "custom_hours", start: "15:00", end: "19:00" }] }] });
    expect(codes(checkSlot(custom, cut, { staffId: "a", start: t(DAY, "10:00"), end: t(DAY, "11:00") }))).toEqual(["staff_outside_hours"]);
    // 休憩は特定日の勤務には含まれない
    expect(checkSlot(custom, cut, { staffId: "a", start: t(DAY, "15:00"), end: t(DAY, "16:00") })).toEqual([]);
  });
  it("営業時間外・定休日・臨時休業を判定する", () => {
    expect(codes(checkSlot(ctx(), cut, { staffId: "a", start: t(DAY, "18:30"), end: t(DAY, "19:30") }))).toContain("outside_hours");
    expect(codes(checkSlot(ctx(), cut, { staffId: "a", start: t("2030-03-04", "10:00"), end: t("2030-03-04", "11:00") }))).toContain("closed_day");
    const closed = ctx({ exceptions: [{ date: DAY, isClosed: true }] });
    expect(codes(checkSlot(closed, cut, { staffId: "a", start: t(DAY, "10:00"), end: t(DAY, "11:00") }))).toContain("closed_day");
  });
  it("担当していないサービス・指名必須の店舗での指名なしを判定する", () => {
    expect(codes(checkSlot(ctx(), { ...cut, staffIds: ["b"] }, { staffId: "a", start: t(DAY, "10:00"), end: t(DAY, "11:00") }))).toContain("staff_not_assigned");
    expect(codes(checkSlot(ctx({ staffSelection: "required" }), cut, { staffId: null, start: t(DAY, "10:00"), end: t(DAY, "11:00") }))).toContain("staff_required");
  });
  it("既存予約の後バッファと重なる枠は競合になる。変更中の予約自身は除外する", () => {
    const busy = ctx({ bookings: [{ id: "x", staffId: "a", resourceIds: [], start: t(DAY, "10:00"), end: t(DAY, "11:10") }] });
    expect(codes(checkSlot(busy, cut, { staffId: "a", start: t(DAY, "11:00"), end: t(DAY, "12:00") }))).toEqual(["staff_conflict"]);
    expect(checkSlot(busy, cut, { staffId: "a", start: t(DAY, "11:10"), end: t(DAY, "12:10") })).toEqual([]);
    expect(checkSlot(busy, cut, { staffId: "a", start: t(DAY, "10:30"), end: t(DAY, "11:30"), excludeBookingId: "x" })).toEqual([]);
  });
  it("必要な設備がすべて使われていれば予約できない", () => {
    const bed: ServiceSpec = { ...cut, resourceIds: ["bed1"] };
    const busy = ctx({ bookings: [{ id: "x", staffId: "b", resourceIds: ["bed1"], start: t(DAY, "12:00"), end: t(DAY, "13:00") }] });
    expect(codes(checkSlot(busy, bed, { staffId: "a", start: t(DAY, "12:00"), end: t(DAY, "13:00") }))).toEqual(["resource_unavailable"]);
  });
  it("受付の締め切り・受付期間を判定する（公開予約のとき）", () => {
    const now = t(DAY, "09:30");
    expect(codes(checkSlot(ctx(), cut, { staffId: "a", start: t(DAY, "10:00"), end: t(DAY, "11:00"), now, enforceBookingWindow: true }))).toEqual(["lead_time"]);
    expect(codes(checkSlot(ctx({ maxAdvanceDays: 3 }), cut, { staffId: "a", start: t(DAY, "11:00"), end: t(DAY, "12:00"), now: t("2030-03-01", "09:00"), enforceBookingWindow: true }))).toEqual(["too_far_ahead"]);
  });
});

describe("空き枠の列挙（openSlots）", () => {
  it("勤務時間・休憩・枠の刻みを守る", () => {
    const slots = openSlots(ctx(), cut, { date: DAY, staffId: "a", now: NOW });
    const starts = slots.map((s) => new Date(s.start).toLocaleTimeString("ja-JP", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }));
    expect(starts[0]).toBe("10:00");
    expect(starts).toContain("12:00");
    expect(starts).not.toContain("12:30"); // 13:00 からの休憩にかかる
    expect(starts).not.toContain("13:00");
    expect(starts).toContain("14:00");
    expect(starts.at(-1)).toBe("18:00");
  });
  it("指名なしなら対応できるスタッフ全員の枠を返す", () => {
    const slots = openSlots(ctx(), cut, { date: DAY, staffId: "any", now: NOW });
    expect(new Set(slots.map((s) => s.staffId))).toEqual(new Set(["a", "b"]));
  });
  it("担当者なしの店舗では設備の空きだけで判定する", () => {
    const space: ServiceSpec = { ...cut, staffIds: [], resourceIds: ["bed1"] };
    const c = ctx({ staffSelection: "none", bookings: [{ id: "x", staffId: null, resourceIds: ["bed1"], start: t(DAY, "10:00"), end: t(DAY, "12:00") }] });
    const slots = openSlots(c, space, { date: DAY, now: NOW });
    expect(slots.every((s) => s.staffId === null && s.resourceId === "bed1")).toBe(true);
    expect(slots[0].start).toBe(t(DAY, "12:00"));
  });
  it("定休日・受付期間外の日は空き枠なし", () => {
    expect(openSlots(ctx(), cut, { date: "2030-03-04", staffId: "a", now: NOW })).toEqual([]);
    expect(openSlots(ctx({ maxAdvanceDays: 2 }), cut, { date: DAY, staffId: "a", now: NOW })).toEqual([]);
  });
  it("受付の締め切りより前の枠は出さない", () => {
    const slots = openSlots(ctx(), cut, { date: DAY, staffId: "a", now: t(DAY, "10:10") });
    expect(slots[0].start).toBe(t(DAY, "11:30"));
  });
});
