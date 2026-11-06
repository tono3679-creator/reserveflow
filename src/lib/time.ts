/**
 * 日時の扱い（DB には UTC で保存し、計算・表示は店舗のタイムゾーンで行う）。
 *   日付は 'YYYY-MM-DD'、時刻は 'HH:MM' の文字列で受け渡す（ブラウザのタイムゾーンに左右されない）
 */
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

export const DEFAULT_TIMEZONE = "Asia/Tokyo";

/** 店舗のタイムゾーンでの日付・時刻 → UTC の Date */
export function zonedDateTime(date: string, time: string, timezone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(new TZDate(y, m - 1, d, hh, mm, 0, 0, timezone).getTime());
}

/** UTC の Date → 店舗のタイムゾーンでの 'YYYY-MM-DD' */
export function localDate(at: Date, timezone: string): string {
  return format(new TZDate(at.getTime(), timezone), "yyyy-MM-dd");
}

/** UTC の Date → 店舗のタイムゾーンでの 'HH:MM' */
export function localTime(at: Date, timezone: string): string {
  return format(new TZDate(at.getTime(), timezone), "HH:mm");
}

/** 店舗のタイムゾーンでの、その時刻の「0時からの分」 */
export function localMinutes(at: Date, timezone: string): number {
  const t = new TZDate(at.getTime(), timezone);
  return t.getHours() * 60 + t.getMinutes();
}

/** 日付の曜日（0=日曜）。タイムゾーンに依存しない */
export function weekdayOf(date: string): number {
  return new Date(utcDay(date)).getUTCDay();
}

/** 日付に日数を足す */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

function utcDay(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** 2つの日付の差（日）。to が後なら正 */
export function diffDays(from: string, to: string): number {
  return Math.round((utcDay(to) - utcDay(from)) / 86_400_000);
}

/** 'HH:MM' → 0時からの分 */
export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** 0時からの分 → 'HH:MM' */
export function fromMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 店舗のタイムゾーンでの、その日の開始（0時）〜翌日0時の UTC */
export function dayRange(date: string, timezone: string): { start: Date; end: Date } {
  return { start: zonedDateTime(date, "00:00", timezone), end: zonedDateTime(addDays(date, 1), "00:00", timezone) };
}
