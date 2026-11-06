/**
 * 通知文の作成（画面にも DB にも依存しない）。材料は通知イベントの payload（作成時点の予約内容）。
 */
import { formatInZone, formatYen } from "@/lib/format";

export type NotificationType = "booking_confirmed" | "booking_changed" | "booking_cancelled" | "reminder_day_before" | "reminder_same_day";

export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  booking_confirmed: "予約確定",
  booking_changed: "予約変更",
  booking_cancelled: "予約キャンセル",
  reminder_day_before: "前日リマインド",
  reminder_same_day: "当日リマインド",
};

export type NotificationPayload = {
  customer_name?: string | null;
  customer_email?: string | null;
  service_name?: string | null;
  staff_name?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  price?: number | null;
  location_name?: string | null;
  timezone?: string | null;
  cancel_reason?: string | null;
};

export type RenderedMessage = { to: string | null; subject: string; text: string };

const HEADLINES: Record<NotificationType, string> = {
  booking_confirmed: "ご予約を承りました。",
  booking_changed: "ご予約の内容を変更しました。",
  booking_cancelled: "ご予約をキャンセルしました。",
  reminder_day_before: "明日のご予約のお知らせです。",
  reminder_same_day: "本日のご予約のお知らせです。",
};

export function renderNotification(type: NotificationType, p: NotificationPayload, options: { manageUrl?: string | null; policy?: string | null } = {}): RenderedMessage {
  const tz = p.timezone || "Asia/Tokyo";
  const when = p.starts_at && p.ends_at
    ? `${formatInZone(p.starts_at, tz, "yyyy年M月d日(E) HH:mm")}〜${formatInZone(p.ends_at, tz, "HH:mm")}`
    : "—";
  const shop = p.location_name ?? "店舗";
  const lines = [
    `${p.customer_name ?? "お客"} 様`,
    "",
    `${shop}です。${HEADLINES[type]}`,
    "",
    `日時：${when}`,
    `内容：${p.service_name ?? "—"}`,
    ...(p.staff_name ? [`担当：${p.staff_name}`] : []),
    ...(typeof p.price === "number" ? [`料金：${formatYen(p.price)}（税込）`] : []),
    ...(type === "booking_cancelled" && p.cancel_reason ? [`理由：${p.cancel_reason}`] : []),
  ];
  if (options.manageUrl && type !== "booking_cancelled") {
    lines.push("", "ご予約の確認・変更・キャンセルはこちら：", options.manageUrl);
  }
  if (options.policy && type !== "booking_cancelled") lines.push("", "【キャンセルについて】", options.policy);
  lines.push("", "※このメールは送信専用です。");
  const date = p.starts_at ? formatInZone(p.starts_at, tz, "M/d HH:mm") : "";
  return {
    to: p.customer_email || null,
    subject: `【${shop}】${NOTIFICATION_LABELS[type]}${date ? `（${date}）` : ""}`,
    text: lines.join("\n"),
  };
}
