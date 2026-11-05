/**
 * 顧客セグメント（判定のルールは店舗設定の値を使い、集計は SQL で行う：src/lib/data/customers.ts）。
 *   未来店   … 来店（来店済み・サービス完了）が0回
 *   休眠     … 最後の来店から「休眠とみなす日数」以上たち、今後の予約もない
 *   VIP      … 来店回数と累計利用額がどちらも VIP の基準以上
 *   リピーター … 来店回数がリピーターの基準以上
 *   新規     … それ以外（来店1回など）
 * 上から順に当てはめ、最初に当てはまったものにする。
 */
export const SEGMENTS = ["vip", "repeat", "new", "dormant", "prospect"] as const;
export type Segment = (typeof SEGMENTS)[number];

export const SEGMENT_LABELS: Record<Segment, string> = {
  vip: "VIP",
  repeat: "リピーター",
  new: "新規",
  dormant: "休眠",
  prospect: "未来店",
};

export const SEGMENT_TONE: Record<Segment, string> = {
  vip: "bg-warning-soft text-warning-strong ring-warning-strong/20",
  repeat: "bg-success-soft text-success-strong ring-success-strong/20",
  new: "bg-info-soft text-info-strong ring-info-strong/20",
  dormant: "bg-muted text-muted-foreground ring-border",
  prospect: "bg-card text-muted-foreground ring-border",
};

export type SegmentRules = { repeatMinVisits: number; vipMinVisits: number; vipMinSpend: number; dormantDays: number };
