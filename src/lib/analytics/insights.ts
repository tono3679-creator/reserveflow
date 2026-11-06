/**
 * ダッシュボードのインサイト。集計済みの実データから、決めた基準を満たしたものだけを文章にする（基準を満たさなければ何も出さない）。
 * 文章には必ず根拠の数値と期間を添える。画面にも DB にも依存しない。
 */
import { formatInZone } from "@/lib/format";
import { percent } from "./rates";

export type Insight = { kind: "up" | "down" | "info"; text: string; basis: string };

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export type InsightInput = {
  timezone: string;
  /** 直近8週の曜日ごとの稼働率 */
  weekday: { weekday: number; availableMinutes: number; bookedMinutes: number; rate: number | null }[];
  weekdayOverall: number | null;
  repeat: { current: { visitors: number; rate: number | null }; previous: { visitors: number; rate: number | null } };
  noShow: { current: { target: number; rate: number | null }; previous: { target: number; rate: number | null } };
  tomorrow: { date: string; free: { ownerName: string; isStaff: boolean; start: number; end: number }[] };
  topService: { name: string; bookings: number; total: number } | null;
};

/** 基準（画面の注記にも出す） */
export const INSIGHT_RULES = {
  weekdayRatio: 1.15,      // 曜日の稼働率が全体の 1.15 倍以上（かつ 5pt 以上の差）
  weekdayMinDiff: 0.05,
  minVisitors: 10,         // リピート率の比較は、両方の期間で来店顧客が 10 人以上
  repeatMinDiff: 0.03,     // 3pt 以上の変化
  minNoShowTarget: 20,     // 無断キャンセル率の比較は、両方の期間で母数が 20 件以上
  noShowMinDiff: 0.02,     // 2pt 以上の変化
  minFreeMinutes: 60,      // 60 分以上の連続した空き
  minServiceBookings: 10,
} as const;

export function buildInsights(input: InsightInput): Insight[] {
  const r = INSIGHT_RULES;
  const out: Insight[] = [];

  // 曜日ごとの稼働率の偏り
  const overall = input.weekdayOverall;
  const days = input.weekday.filter((d) => d.availableMinutes > 0 && d.rate !== null) as { weekday: number; rate: number }[];
  if (overall !== null && overall > 0 && days.length >= 2) {
    const top = [...days].sort((a, b) => b.rate - a.rate)[0];
    if (top.rate >= overall * r.weekdayRatio && top.rate - overall >= r.weekdayMinDiff) {
      out.push({ kind: "up", text: `${WEEKDAYS[top.weekday]}曜日の予約枠稼働率が高い（${percent(top.rate)}。全体は ${percent(overall)}）`, basis: "直近8週の稼働率" });
    }
    const low = [...days].sort((a, b) => a.rate - b.rate)[0];
    if (low.weekday !== top.weekday && low.rate <= overall / r.weekdayRatio && overall - low.rate >= r.weekdayMinDiff) {
      out.push({ kind: "down", text: `${WEEKDAYS[low.weekday]}曜日は予約枠稼働率が低め（${percent(low.rate)}。全体は ${percent(overall)}）`, basis: "直近8週の稼働率" });
    }
  }

  // リピート率の変化
  const rp = input.repeat;
  if (rp.current.rate !== null && rp.previous.rate !== null && rp.current.visitors >= r.minVisitors && rp.previous.visitors >= r.minVisitors) {
    const diff = rp.current.rate - rp.previous.rate;
    if (Math.abs(diff) >= r.repeatMinDiff) {
      out.push({
        kind: diff > 0 ? "up" : "down",
        text: `直近30日のリピート率が${diff > 0 ? "上昇" : "低下"}（${percent(rp.previous.rate)} → ${percent(rp.current.rate)}）`,
        basis: `来店顧客 ${rp.current.visitors}人（前の30日は ${rp.previous.visitors}人）`,
      });
    }
  }

  // 無断キャンセル率の変化
  const ns = input.noShow;
  if (ns.current.rate !== null && ns.previous.rate !== null && ns.current.target >= r.minNoShowTarget && ns.previous.target >= r.minNoShowTarget) {
    const diff = ns.current.rate - ns.previous.rate;
    if (Math.abs(diff) >= r.noShowMinDiff) {
      out.push({
        kind: diff > 0 ? "down" : "up",
        text: `直近30日の無断キャンセル率が${diff > 0 ? "上昇" : "低下"}（${percent(ns.previous.rate)} → ${percent(ns.current.rate)}）`,
        basis: `母数 ${ns.current.target}件（前の30日は ${ns.previous.target}件）`,
      });
    }
  }

  // 明日のまとまった空き（長い順に2件まで）
  const tz = input.timezone;
  const free = input.tomorrow.free.filter((f) => (f.end - f.start) / 60_000 >= r.minFreeMinutes).slice(0, 2);
  for (const f of free) {
    const minutes = (f.end - f.start) / 60_000;
    const length = minutes % 60 === 0 ? `${minutes / 60}時間` : `${Math.floor(minutes / 60)}時間${minutes % 60}分`;
    out.push({
      kind: "info",
      text: `明日 ${formatInZone(new Date(f.start), tz, "M月d日(E) HH:mm")}〜${formatInZone(new Date(f.end), tz, "HH:mm")} に${f.isStaff ? `${f.ownerName}さん` : f.ownerName}の空きがあります（${length}）`,
      basis: "勤務時間・営業時間と現在の予約から計算",
    });
  }

  // よく予約されるサービス
  const ts = input.topService;
  if (ts && ts.total >= r.minServiceBookings && ts.bookings > 0) {
    out.push({ kind: "info", text: `直近30日の予約は「${ts.name}」が最多（${ts.bookings}件・全体の ${percent(ts.bookings / ts.total, 0)}）`, basis: `予約 ${ts.total}件` });
  }
  return out;
}
