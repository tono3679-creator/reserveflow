import "server-only";
import { createHash, createHmac } from "node:crypto";
import { serverEnv } from "@/lib/env";

/**
 * 予約の確認・変更・キャンセル用のリンクのトークン。
 * 予約 ID と秘密の値（APP_SECRET）から作る HMAC（256 ビット）なので推測できない。
 * DB には SHA-256 だけを保存し（bookings.manage_token_hash）、通知文を作るときにも同じ値を作り直せる。
 */
export const MANAGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function manageToken(bookingId: string): string {
  return createHmac("sha256", serverEnv.appSecret).update(`manage:${bookingId}`).digest("base64url");
}

export function manageTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function manageUrl(slug: string, bookingId: string): string {
  return `${serverEnv.appUrl}/book/${slug}/manage/${manageToken(bookingId)}`;
}
