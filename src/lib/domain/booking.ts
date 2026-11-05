/** 予約ステータス（表示名・色・枠を占有するか）。DB の booking_status と同じ値 */
export const BOOKING_STATUSES = ["confirmed", "checked_in", "completed", "cancelled_customer", "cancelled_store", "no_show"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const STATUS_LABELS: Record<BookingStatus, string> = {
  confirmed: "予約確定",
  checked_in: "来店済み",
  completed: "サービス完了",
  cancelled_customer: "顧客キャンセル",
  cancelled_store: "店舗キャンセル",
  no_show: "無断キャンセル",
};

/** バッジの見た目（色だけに頼らず文字でも区別する） */
export const STATUS_TONE: Record<BookingStatus, "info" | "brand" | "success" | "muted" | "warning" | "danger"> = {
  confirmed: "info",
  checked_in: "brand",
  completed: "success",
  cancelled_customer: "muted",
  cancelled_store: "warning",
  no_show: "danger",
};

/** 枠（スタッフ・設備の時間）を占有するステータス。DB の booking_blocks_slot() と同じ */
export function blocksSlot(status: BookingStatus): boolean {
  return status === "confirmed" || status === "checked_in" || status === "completed";
}

/** ステータスを変更できる組み合わせ（DB 関数 set_booking_status と同じ） */
const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  confirmed: ["checked_in", "completed", "no_show", "cancelled_customer", "cancelled_store"],
  checked_in: ["completed", "confirmed", "no_show"],
  completed: ["checked_in", "confirmed"],
  no_show: ["confirmed", "checked_in", "completed"],
  cancelled_customer: ["confirmed"],
  cancelled_store: ["confirmed"],
};

const CANCELLED: BookingStatus[] = ["cancelled_customer", "cancelled_store"];

/** 画面に出すステータス変更の選択肢（役割と開始時刻も考える） */
export function nextStatuses(status: BookingStatus, options: { canCancel: boolean; startsAt: Date; now?: Date }): BookingStatus[] {
  const now = options.now ?? new Date();
  const started = options.startsAt.getTime() <= now.getTime() + 3_600_000;
  return TRANSITIONS[status].filter((s) => {
    if (!options.canCancel && (CANCELLED.includes(s) || CANCELLED.includes(status))) return false;
    if (!started && (s === "checked_in" || s === "completed" || s === "no_show")) return false;
    return true;
  });
}

export function isCancelled(status: BookingStatus): boolean {
  return CANCELLED.includes(status);
}
