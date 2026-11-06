import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { enqueueReminders, processNotifications } from "@/lib/notifications/process";
import { rejectUnlessCron } from "@/lib/security/cron";

/** 毎日1回：前日・当日のリマインドを作り、未送信の通知を送る */
export async function GET(req: NextRequest) {
  const rejected = rejectUnlessCron(req);
  if (rejected) return rejected;
  const sql = db();
  const reminders = await enqueueReminders(sql);
  let processed = 0;
  // 1回の実行時間を抑えるため、最大 10 回 × 50 件まで
  for (let i = 0; i < 10; i++) {
    const r = await processNotifications(sql, { limit: 50 });
    processed += r.processed;
    if (r.processed < 50) break;
  }
  return NextResponse.json({ reminders: reminders.checked, processed });
}
