/** スマート空き枠提案：候補の探索（判定条件）・スコアリング・重み・おすすめ理由 */
import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS, suggestSlots, type SuggestionRequest, type SuggestionWeights } from "../../src/lib/suggestions/engine";
import type { SchedulingContext, ServiceSpec } from "../../src/lib/scheduling/types";
import { localTime, zonedDateTime } from "../../src/lib/time";

const TZ = "Asia/Tokyo";
const t = (date: string, hhmm: string) => zonedDateTime(date, hhmm, TZ).getTime();
// 2030-03-05 は火曜日、2030-03-04 は月曜日（定休日）
const DAY = "2030-03-05";
const NOW = t("2030-03-01", "09:00");
const hm = (ms: number) => localTime(new Date(ms), TZ);

function ctx(overrides: Partial<SchedulingContext> = {}): SchedulingContext {
  return {
    timezone: TZ, slotIntervalMinutes: 30, minLeadMinutes: 60, maxAdvanceDays: 60, staffSelection: "optional",
    businessHours: [2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "10:00", closes: "19:00" })),
    exceptions: [],
    staff: [
      { id: "a", name: "佐藤", schedules: [2, 3].map((weekday) => ({ weekday, start: "10:00", end: "19:00", breakStart: "13:00", breakEnd: "14:00" })), timeOff: [] },
      { id: "b", name: "高橋", schedules: [2, 3].map((weekday) => ({ weekday, start: "10:00", end: "19:00" })), timeOff: [] },
    ],
    resources: [],
    bookings: [],
    ...overrides,
  };
}
const cut: ServiceSpec = { id: "cut", name: "カット", durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, staffIds: ["a", "b"], resourceIds: [] };
const req = (o: Partial<SuggestionRequest> = {}): SuggestionRequest => ({ date: DAY, searchDays: 1, count: 5, now: NOW, minUsableMinutes: 60, ...o });
const only = (w: Partial<SuggestionWeights>): SuggestionWeights => ({ preferredTime: 0, gap: 0, balance: 0, idle: 0, ...w });
const booking = (id: string, staffId: string, from: string, to: string, date = DAY) => ({ id, staffId, resourceIds: [], start: t(date, from), end: t(date, to) });

describe("候補の探索", () => {
  it("予約できる枠だけを候補にする（休憩・既存予約・定休日・希望時間帯・件数）", () => {
    const c = ctx({ bookings: [booking("x", "b", "10:00", "19:00")] });
    const out = suggestSlots(c, cut, req({ count: 20 }), DEFAULT_WEIGHTS);
    // 高橋さんは終日予約済み、佐藤さんは休憩 13:00-14:00 がある
    expect(out.every((s) => s.staffId === "a")).toBe(true);
    expect(out.map((s) => hm(s.start))).not.toContain("12:30");
    expect(out.map((s) => hm(s.start))).not.toContain("13:00");
    expect(suggestSlots(c, cut, req({ date: "2030-03-04" }), DEFAULT_WEIGHTS)).toEqual([]);
    const windowed = suggestSlots(c, cut, req({ window: { from: "15:00", to: "17:00" }, count: 20 }), DEFAULT_WEIGHTS);
    expect(windowed.map((s) => hm(s.start)).sort()).toEqual(["15:00", "15:30", "16:00", "16:30"]);
    expect(suggestSlots(c, cut, req({ count: 2 }), DEFAULT_WEIGHTS)).toHaveLength(2);
  });

  it("必要な設備が空いていない時間は候補にしない", () => {
    const bed: ServiceSpec = { ...cut, resourceIds: ["r1"] };
    const c = ctx({ resources: [{ id: "r1", name: "ベッド" }], bookings: [{ id: "x", staffId: null, resourceIds: ["r1"], start: t(DAY, "10:00"), end: t(DAY, "18:00") }] });
    const out = suggestSlots(c, bed, req({ count: 20 }), DEFAULT_WEIGHTS);
    expect(out.map((s) => hm(s.start))).toEqual(["18:00"]);
    expect(out[0].resourceName).toBe("ベッド");
  });

  it("希望スタッフを指定するとその人の枠だけ。同じ開始時刻は1件にまとめる", () => {
    expect(suggestSlots(ctx(), cut, req({ staffId: "b", count: 50 }), DEFAULT_WEIGHTS).every((s) => s.staffId === "b")).toBe(true);
    const all = suggestSlots(ctx(), cut, req({ count: 50 }), DEFAULT_WEIGHTS);
    expect(new Set(all.map((s) => s.start)).size).toBe(all.length);
  });

  it("受付の締め切りより前の枠は出さない", () => {
    const out = suggestSlots(ctx(), cut, req({ now: t(DAY, "14:10"), count: 50 }), DEFAULT_WEIGHTS);
    expect(Math.min(...out.map((s) => s.start))).toBeGreaterThanOrEqual(t(DAY, "15:10"));
  });
});

describe("スコアリング", () => {
  it("希望時刻に近い枠ほど高い。希望日から離れた日は下がる", () => {
    const out = suggestSlots(ctx(), cut, req({ preferredTime: "15:00", searchDays: 2, count: 50 }), only({ preferredTime: 1 }));
    expect(hm(out[0].start)).toBe("15:00");
    expect(out[0].date).toBe(DAY);
    expect(out[0].score).toBeCloseTo(100);
    expect(out[0].reasons).toContain("希望時刻（15:00）ちょうどです");
    const nextDay = out.find((s) => s.date === "2030-03-06" && hm(s.start) === "15:00");
    expect(nextDay?.score).toBeCloseTo(75);
  });

  it("既存予約の直後の枠を優先し、理由を添える。半端な空きを残す枠は低い", () => {
    const c = ctx({ staff: [ctx().staff[1]], bookings: [booking("x", "b", "11:00", "12:00")] });
    const out = suggestSlots(c, { ...cut, staffIds: ["b"] }, req({ count: 50 }), only({ gap: 1 }));
    const byTime = new Map(out.map((s) => [hm(s.start), s]));
    expect(byTime.get("12:00")?.score).toBeGreaterThan(byTime.get("15:00")?.score ?? 100);
    expect(byTime.get("12:00")?.reasons).toContain("既存予約の直後に配置できるため、空き時間を減らせます");
    // 12:30 開始は前に30分の使いにくい空きを残す
    expect(byTime.get("12:30")?.score).toBeLessThan(byTime.get("15:00")?.score ?? 0);
    expect(byTime.get("12:30")?.reasons.some((r) => r.includes("30分の短い空き"))).toBe(true);
    // 10:00 は前後の予約・勤務開始の間にぴったり収まる
    expect(byTime.get("10:00")?.score).toBeCloseTo(100);
  });

  it("稼働率の低いスタッフに割り当てる（平準化）", () => {
    const c = ctx({ bookings: [booking("x", "a", "10:00", "13:00")] });
    const out = suggestSlots(c, cut, req({ count: 50 }), only({ balance: 1 }));
    const at15 = out.find((s) => hm(s.start) === "15:00");
    expect(at15?.staffId).toBe("b");
    expect(at15?.reasons.some((r) => r.startsWith("高橋さんはこの日の稼働率が 0%"))).toBe(true);
  });

  it("店舗全体で手が空いている時間帯を高く評価する（未利用時間の削減）", () => {
    const c = ctx({ bookings: [booking("x", "a", "15:00", "17:00")] });
    const out = suggestSlots(c, cut, req({ count: 50 }), only({ idle: 1 }));
    const byTime = new Map(out.map((s) => [hm(s.start), s]));
    expect(byTime.get("11:00")?.score).toBeCloseTo(100);
    expect(byTime.get("15:00")?.score).toBeCloseTo(50);
    expect(byTime.get("11:00")?.reasons.some((r) => r.includes("2人のうち 2人が空いて"))).toBe(true);
  });

  it("重みを変えると順位が変わる。評価できない項目は重みごと除く", () => {
    const c = ctx({ bookings: [booking("x", "b", "10:00", "11:00")] });
    const nearPreferred = suggestSlots(c, cut, req({ preferredTime: "17:00" }), only({ preferredTime: 1 }))[0];
    const tight = suggestSlots(c, cut, req({ preferredTime: "17:00" }), only({ gap: 1 }))[0];
    expect(hm(nearPreferred.start)).toBe("17:00");
    expect(hm(tight.start)).not.toBe("17:00");
    // 希望時刻の指定がなく1日だけなら「近さ」は評価しない
    const noPref = suggestSlots(c, cut, req(), DEFAULT_WEIGHTS)[0];
    expect(noPref.factors.map((f) => f.key)).not.toContain("preferredTime");
    expect(noPref.factors.reduce((s, f) => s + f.points, 0)).toBeCloseTo(noPref.score);
  });

  it("スタッフのいない店舗（レンタルスペース）は設備で評価する", () => {
    const room: ServiceSpec = { ...cut, staffIds: [], resourceIds: ["r1", "r2"] };
    const c = ctx({
      staffSelection: "none", staff: [], resources: [{ id: "r1", name: "A室" }, { id: "r2", name: "B室" }],
      bookings: [{ id: "x", staffId: null, resourceIds: ["r1"], start: t(DAY, "10:00"), end: t(DAY, "12:00") }],
    });
    const out = suggestSlots(c, room, req({ count: 50 }), DEFAULT_WEIGHTS);
    expect(out[0].staffId).toBeNull();
    expect(out[0].factors.map((f) => f.key)).not.toContain("balance");
    const noon = out.find((s) => hm(s.start) === "12:00");
    expect(noon?.resourceId).toBe("r1");
    expect(noon?.reasons).toContain("既存予約の直後に配置できるため、空き時間を減らせます");
  });
});
