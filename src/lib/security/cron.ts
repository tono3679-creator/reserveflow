import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";

/** Vercel Cron からの呼び出しか（Authorization: Bearer CRON_SECRET）。未設定なら常に拒否 */
export function rejectUnlessCron(req: NextRequest): NextResponse | null {
  const secret = serverEnv.cronSecret;
  if (secret.length < 16) return NextResponse.json({ error: "CRON_SECRET が設定されていません" }, { status: 503 });
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return NextResponse.json({ error: "認証できません" }, { status: 401 });
  return null;
}
