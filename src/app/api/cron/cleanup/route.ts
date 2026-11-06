import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { cleanupExpiredDemos } from "@/lib/demo/create";
import { rebuildShowcase } from "@/lib/demo/showcase";
import { rejectUnlessCron } from "@/lib/security/cron";

export const maxDuration = 60;

/**
 * 毎日1回：期限切れのデモ環境と古いセッション・レート制限の記録を消し、
 * 見本の企業（公開予約ページ /book/demo-salon など）を今日基準で作り直す。
 * 公開予約ページから見本に入った予約もここで消えるため、共有の見本データが恒久的に書き換わらない。
 */
export async function GET(req: NextRequest) {
  const rejected = rejectUnlessCron(req);
  if (rejected) return rejected;
  const sql = db();
  const deleted = await cleanupExpiredDemos(sql);
  await rebuildShowcase(sql);
  return NextResponse.json({ deletedDemoSessions: deleted, showcaseRebuilt: true });
}
