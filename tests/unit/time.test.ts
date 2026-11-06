import { describe, expect, it } from "vitest";
import { addDays, dayRange, diffDays, localDate, localTime, weekdayOf, zonedDateTime } from "../../src/lib/time";

describe("時刻の変換（UTC で保存し、店舗のタイムゾーンで扱う）", () => {
  it("東京の 10:00 は UTC の 01:00", () => {
    expect(zonedDateTime("2026-11-12", "10:00", "Asia/Tokyo").toISOString()).toBe("2026-11-12T01:00:00.000Z");
  });
  it("UTC の日時を店舗の日付・時刻で表す（日付をまたぐ場合）", () => {
    const at = new Date("2026-11-11T16:30:00Z");
    expect(localDate(at, "Asia/Tokyo")).toBe("2026-11-12");
    expect(localTime(at, "Asia/Tokyo")).toBe("01:30");
    expect(localDate(at, "Pacific/Honolulu")).toBe("2026-11-11");
  });
  it("その日の範囲", () => {
    const { start, end } = dayRange("2026-11-12", "Asia/Tokyo");
    expect(start.toISOString()).toBe("2026-11-11T15:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-12T15:00:00.000Z");
  });
  it("日付の計算", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(diffDays("2026-11-01", "2026-12-01")).toBe(30);
    expect(weekdayOf("2026-11-12")).toBe(4);
  });
});
