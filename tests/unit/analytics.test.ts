/** 分析の期間・比較・稼働率（画面にも DB にも依存しない計算） */
import { describe, expect, it } from "vitest";
import { capacity, freeWindows } from "../../src/lib/analytics/capacity";
import { buildInsights, type InsightInput } from "../../src/lib/analytics/insights";
import { previousPeriod, resolvePeriod } from "../../src/lib/analytics/period";
import { compareAmount, compareRate, formatComparison, ratio } from "../../src/lib/analytics/rates";
import type { SchedulingContext } from "../../src/lib/scheduling/types";
import { zonedDateTime } from "../../src/lib/time";

const TZ = "Asia/Tokyo";
const t = (date: string, hhmm: string) => zonedDateTime(date, hhmm, TZ).getTime();
const DAY = "2030-03-05"; // 火曜日

function ctx(overrides: Partial<SchedulingContext> = {}): SchedulingContext {
  return {
    timezone: TZ, slotIntervalMinutes: 30, minLeadMinutes: 0, maxAdvanceDays: 60, staffSelection: "optional",
    businessHours: [2].map((weekday) => ({ weekday, opens: "10:00", closes: "19:00" })),
    exceptions: [],
    staff: [
      { id: "a", name: "佐藤", schedules: [{ weekday: 2, start: "10:00", end: "19:00", breakStart: "13:00", breakEnd: "14:00" }], timeOff: [] },
      { id: "b", name: "高橋", schedules: [{ weekday: 2, start: "15:00", end: "19:00" }], timeOff: [] },
    ],
    resources: [{ id: "room", name: "ルームA" }],
    bookings: [],
    ...overrides,
  };
}

describe("対象期間", () => {
  const today = "2026-11-05";
  it("今月は月初〜今日、先月は先月1日〜末日、直近30日は今日を含む30日", () => {
    expect(resolvePeriod({ preset: "this_month" }, today).period).toEqual({ from: "2026-11-01", to: "2026-11-05" });
    expect(resolvePeriod({ preset: "last_month" }, today).period).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(resolvePeriod({ preset: "last_30" }, today).period).toEqual({ from: "2026-10-07", to: "2026-11-05" });
  });
  it("不正な指定は既定の期間にする", () => {
    expect(resolvePeriod({ preset: "custom", from: "2026-11-10", to: "2026-11-01" }, today).preset).toBe("last_90");
    expect(resolvePeriod({ preset: "bogus" }, today).preset).toBe("last_90");
    expect(resolvePeriod({ preset: "custom", from: "2026-01-01", to: "2026-01-31" }, today).period).toEqual({ from: "2026-01-01", to: "2026-01-31" });
  });
  it("比べる期間：月の途中までは前月の同じ日数、丸1か月は前月、それ以外は直前の同じ日数", () => {
    expect(previousPeriod({ from: "2026-11-01", to: "2026-11-05" })).toEqual({ from: "2026-10-01", to: "2026-10-05" });
    expect(previousPeriod({ from: "2026-03-01", to: "2026-03-31" })).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(previousPeriod({ from: "2026-03-01", to: "2026-03-30" })).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(previousPeriod({ from: "2026-10-07", to: "2026-11-05" })).toEqual({ from: "2026-09-07", to: "2026-10-06" });
    expect(previousPeriod({ from: "2026-01-01", to: "2026-03-31" })).toEqual({ from: "2025-10-03", to: "2025-12-31" });
  });
});

describe("率と比較", () => {
  it("母数が 0 なら null、件数は増減率、率はポイント差", () => {
    expect(ratio(1, 0)).toBeNull();
    expect(ratio(1, 4)).toBe(0.25);
    expect(formatComparison(compareAmount(120, 100))).toBe("+20.0%");
    expect(formatComparison(compareAmount(5, 0))).toBe("比較データなし");
    expect(formatComparison(compareRate(0.12, 0.15))).toBe("−3.0pt");
  });
});

describe("予約枠の稼働率", () => {
  it("スタッフの勤務時間（休憩を除く）のうち予約の占有時間。勤務時間外にはみ出した分は数えない", () => {
    const c = capacity(ctx({
      bookings: [
        { id: "1", staffId: "a", resourceIds: [], start: t(DAY, "10:00"), end: t(DAY, "12:00") },
        { id: "2", staffId: "b", resourceIds: [], start: t(DAY, "14:00"), end: t(DAY, "16:00") }, // 15:00 からの勤務なので 1 時間だけ
      ],
    }), [DAY, "2030-03-06"]);
    // 勤務：佐藤 8時間 + 高橋 4時間 = 720 分。予約：120 + 60 = 180 分
    expect(c).toMatchObject({ basis: "staff", availableMinutes: 720, bookedMinutes: 180, rate: 0.25 });
    expect(c.byWeekday[2]).toMatchObject({ availableMinutes: 720, bookedMinutes: 180 });
    expect(c.byWeekday[3].rate).toBeNull();
    expect(c.byStaff.find((s) => s.staffId === "b")!.rate).toBe(0.25);
  });
  it("スタッフを割り当てない店舗は、設備ごとの営業時間で計算する", () => {
    const c = capacity(ctx({
      staffSelection: "none",
      bookings: [{ id: "1", staffId: null, resourceIds: ["room"], start: t(DAY, "10:00"), end: t(DAY, "13:00") }],
    }), [DAY]);
    expect(c).toMatchObject({ basis: "resource", availableMinutes: 540, bookedMinutes: 180 });
    expect(c.rate).toBeCloseTo(1 / 3);
  });
  it("空き時間は予約の間の連続した時間帯を長い順に返す", () => {
    const free = freeWindows(ctx({
      bookings: [{ id: "1", staffId: "a", resourceIds: [], start: t(DAY, "10:00"), end: t(DAY, "12:00") }],
    }), DAY);
    expect(free[0]).toMatchObject({ ownerId: "a", start: t(DAY, "14:00"), end: t(DAY, "19:00") });
    expect(free.some((f) => f.ownerId === "a" && f.start === t(DAY, "12:00") && f.end === t(DAY, "13:00"))).toBe(true);
  });
});

describe("インサイト（基準を満たしたものだけを出す）", () => {
  const base: InsightInput = {
    timezone: TZ,
    weekday: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, availableMinutes: 1000, bookedMinutes: 500, rate: 0.5 })),
    weekdayOverall: 0.5,
    repeat: { current: { visitors: 30, rate: 0.5 }, previous: { visitors: 30, rate: 0.5 } },
    noShow: { current: { target: 50, rate: 0.05 }, previous: { target: 50, rate: 0.05 } },
    tomorrow: { date: "2030-03-05", free: [] },
    topService: null,
  };
  it("偏り・変化がなければ何も出さない", () => {
    expect(buildInsights(base)).toEqual([]);
  });
  it("曜日の偏り・リピート率と無断キャンセル率の変化・明日の空きを根拠つきで出す", () => {
    const list = buildInsights({
      ...base,
      weekday: base.weekday.map((d) => (d.weekday === 5 ? { ...d, rate: 0.72 } : d)),
      repeat: { current: { visitors: 30, rate: 0.58 }, previous: { visitors: 28, rate: 0.52 } },
      noShow: { current: { target: 50, rate: 0.02 }, previous: { target: 50, rate: 0.06 } },
      tomorrow: { date: DAY, free: [{ ownerName: "佐藤", isStaff: true, start: t(DAY, "14:00"), end: t(DAY, "16:00") }, { ownerName: "高橋", isStaff: true, start: t(DAY, "10:00"), end: t(DAY, "10:30") }] },
    });
    expect(list.map((i) => i.text)).toEqual([
      "金曜日の予約枠稼働率が高い（72.0%。全体は 50.0%）",
      "直近30日のリピート率が上昇（52.0% → 58.0%）",
      "直近30日の無断キャンセル率が低下（6.0% → 2.0%）",
      "明日 3月5日(火) 14:00〜16:00 に佐藤さんの空きがあります（2時間）",
    ]);
    expect(list[2].kind).toBe("up");
  });
  it("母数が少ないときは比べない", () => {
    expect(buildInsights({ ...base, repeat: { current: { visitors: 5, rate: 0.9 }, previous: { visitors: 30, rate: 0.5 } } })).toEqual([]);
  });
});
