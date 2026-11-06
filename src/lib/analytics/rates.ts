/** 率と、前の期間との比較（画面・サーバー共通） */

/** 分子 ÷ 分母（0〜1）。分母が 0 なら計算できない（null） */
export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export type Comparison =
  | { kind: "percent"; value: number }   // 件数・金額：増減率（+0.12 = +12%）
  | { kind: "points"; value: number }    // 率：差（ポイント。+0.03 = +3.0pt）
  | { kind: "none" };                    // 前の期間に母数がなく比べられない

/** 件数・金額の比較（増減率） */
export function compareAmount(current: number | null, previous: number | null): Comparison {
  if (current === null || previous === null || previous === 0) return { kind: "none" };
  return { kind: "percent", value: (current - previous) / previous };
}

/** 率どうしの比較（ポイント差） */
export function compareRate(current: number | null, previous: number | null): Comparison {
  if (current === null || previous === null) return { kind: "none" };
  return { kind: "points", value: current - previous };
}

export function formatComparison(c: Comparison): string {
  if (c.kind === "none") return "比較データなし";
  const sign = c.value > 0 ? "+" : c.value < 0 ? "−" : "±";
  const abs = Math.abs(c.value) * 100;
  return c.kind === "percent" ? `${sign}${abs.toFixed(1)}%` : `${sign}${abs.toFixed(1)}pt`;
}

/** 0〜1 の率 → '12.3%' */
export function percent(value: number | null, digits = 1): string {
  return value === null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
}
