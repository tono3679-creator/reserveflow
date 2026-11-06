import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ja } from "date-fns/locale";

const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" });
const number = new Intl.NumberFormat("ja-JP");

/** 金額（円の整数） */
export function formatYen(value: number): string {
  return yen.format(value);
}

export function formatNumber(value: number): string {
  return number.format(value);
}

export function formatPercent(value: number | null, digits = 1): string {
  return value === null || !Number.isFinite(value) ? "—" : `${value.toFixed(digits)}%`;
}

/** 店舗のタイムゾーンで日時を表示する */
export function formatInZone(at: Date | string, timezone: string, pattern: string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return format(new TZDate(d.getTime(), timezone), pattern, { locale: ja });
}

export function formatDateLong(at: Date, timezone: string): string {
  return formatInZone(at, timezone, "yyyy年M月d日(E)");
}
