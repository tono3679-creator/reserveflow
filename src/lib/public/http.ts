import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hit } from "@/lib/auth/rate-limit";
import { PublicBookingError } from "./booking";

/** 公開 API の共通処理：レート制限・同一オリジンの確認・エラーの言い換え */
export function clientIpOf(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

export async function limit(req: NextRequest, name: string, max: number, windowSeconds: number): Promise<NextResponse | null> {
  const ok = await hit(`public:${name}:${clientIpOf(req)}`, max, windowSeconds);
  if (ok) return null;
  return NextResponse.json({ error: "短時間に操作が集中しています。しばらく待ってからお試しください。" }, { status: 429, headers: { "retry-after": String(windowSeconds) } });
}

/**
 * 書き込みは同じサイトのページからだけ受け付ける（CSRF 対策）。
 * ブラウザが付ける Origin / Sec-Fetch-Site を確かめ、JSON 以外の送信も拒否する。
 */
export function sameOrigin(req: NextRequest): NextResponse | null {
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const okOrigin = origin ? (() => { try { return new URL(origin).host === host; } catch { return false; } })() : site === "same-origin";
  const okType = (req.headers.get("content-type") ?? "").startsWith("application/json");
  if (okOrigin && okType && (!site || site === "same-origin")) return null;
  return NextResponse.json({ error: "この操作は受け付けられません" }, { status: 403 });
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof PublicBookingError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of e.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
    return NextResponse.json({ error: "入力内容を確認してください", fieldErrors }, { status: 400 });
  }
  if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P0001") {
    return NextResponse.json({ error: (e as unknown as Error).message }, { status: 409 });
  }
  console.error("public api error", e);
  return NextResponse.json({ error: "処理できませんでした。時間をおいてもう一度お試しください。" }, { status: 500 });
}

export const noStore = { "cache-control": "no-store" };
