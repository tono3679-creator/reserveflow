import "server-only";
/**
 * アプリのログインセッション（AUTH_PROVIDER=local のログインと、デモ利用者）。
 *   Cookie：推測できないランダムな値（HttpOnly・SameSite=Lax・本番では Secure）
 *   DB（app_private.sessions）：その SHA-256 と利用者・期限だけを保存する（DB が漏れても Cookie として使えない）
 * 確認は毎回 DB で行うので、ログアウト・期限切れはすぐに効く。
 */
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { SESSION_COOKIE, SESSION_TOKEN_PATTERN } from "./cookies";

export const SESSION_TTL_MS = 30 * 24 * 3600_000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** セッションを作って Cookie に入れる（この端末の以前のセッションは消す） */
export async function startSession(userId: string, ttlMs: number = SESSION_TTL_MS): Promise<void> {
  const store = await cookies();
  const previous = store.get(SESSION_COOKIE)?.value;
  const token = newToken();
  const expiresAt = new Date(Date.now() + ttlMs);
  await db().begin(async (tx) => {
    if (previous && SESSION_TOKEN_PATTERN.test(previous)) {
      await tx`delete from app_private.sessions where token_hash = ${hashToken(previous)}`;
    }
    await tx`insert into app_private.sessions (token_hash, user_id, expires_at) values (${hashToken(token)}, ${userId}, ${expiresAt})`;
  });
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/** 今のセッションの利用者を入れ替える（デモで立場を切り替えるとき。Cookie はそのまま） */
export async function switchSessionUser(userId: string): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !SESSION_TOKEN_PATTERN.test(token)) return false;
  const rows = await db()`update app_private.sessions set user_id = ${userId}
    where token_hash = ${hashToken(token)} and expires_at > now() returning 1`;
  return rows.length > 0;
}

export async function readSession(): Promise<{ id: string; isAnonymous: boolean } | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !SESSION_TOKEN_PATTERN.test(token)) return null;
  const [row] = await db()<{ id: string; is_anonymous: boolean }[]>`
    select u.id, u.is_anonymous
      from app_private.sessions s join auth.users u on u.id = s.user_id
     where s.token_hash = ${hashToken(token)} and s.expires_at > now()`;
  return row ? { id: row.id, isAnonymous: row.is_anonymous } : null;
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token && SESSION_TOKEN_PATTERN.test(token)) await db()`delete from app_private.sessions where token_hash = ${hashToken(token)}`;
  store.delete(SESSION_COOKIE);
}
