import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { cleanupExpiredDemos } from "@/lib/demo/create";
import { rejectUnlessCron } from "@/lib/security/cron";

/** 毎日1回：期限切れのデモ環境と古いレート制限の記録を消す */
export async function GET(req: NextRequest) {
  const rejected = rejectUnlessCron(req);
  if (rejected) return rejected;
  const deleted = await cleanupExpiredDemos(db());
  return NextResponse.json({ deletedDemoSessions: deleted });
}
