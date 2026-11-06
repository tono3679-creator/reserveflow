import "server-only";
import { headers } from "next/headers";
import { db } from "@/lib/db";

/**
 * 回数の制限。bucket ごとに、直近 windowSeconds 秒の記録が max 件に達していたら false。
 * DB に記録するので、サーバーが複数台（Vercel の複数インスタンス）でも同じ上限が効く。
 */
export async function underLimit(bucket: string, max: number, windowSeconds: number): Promise<boolean> {
  const [row] = await db()<{ n: number }[]>`
    select count(*)::int n from app_private.rate_limits
     where bucket = ${bucket} and created_at > now() - make_interval(secs => ${windowSeconds})`;
  return row.n < max;
}

export async function recordHit(bucket: string): Promise<void> {
  await db()`insert into app_private.rate_limits (bucket) values (${bucket})`;
}

/** 数えてから判定する（公開 API 用）。上限を超えていたら false */
export async function hit(bucket: string, max: number, windowSeconds: number): Promise<boolean> {
  if (!(await underLimit(bucket, max, windowSeconds))) return false;
  await recordHit(bucket);
  return true;
}

/** 接続元の IP（Vercel では x-forwarded-for の先頭がクライアント） */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}
