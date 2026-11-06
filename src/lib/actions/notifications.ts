"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueueReminders, processNotifications } from "@/lib/notifications/process";
import { runAction, UserFacingError, type ActionResult } from "./result";

/**
 * 通知の操作（オーナー・マネージャー）。
 * 送信記録の書き換えはサーバーの処理だけが行う（RLS では読み取りのみ）ので、
 * まず利用者の権限で対象が見えることを確かめてから、サーバーの接続で処理する。
 */

/** 送信に失敗した通知をもう一度送る */
export async function retryNotification(deliveryId: unknown): Promise<ActionResult<{ processed: number }>> {
  return runAction(async () => {
    const id = z.uuid().parse(deliveryId);
    const orgId = await withAuth("notifications.view", async (tx, ctx) => {
      const [row] = await tx<{ status: string }[]>`
        select d.status from public.notification_deliveries d
          join public.notification_events e on e.id = d.event_id
         where d.id = ${id} and e.location_id = ${ctx.location.id}`;
      if (!row) throw new UserFacingError("通知が見つかりません");
      if (row.status !== "failed") throw new UserFacingError("再送できるのは送信に失敗した通知だけです");
      return ctx.organizationId;
    });
    const sql = db();
    await sql`update public.notification_deliveries
       set status = 'failed', attempts = 0, updated_at = now() - interval '2 minutes'
     where id = ${id} and status = 'failed'`;
    const result = await processNotifications(sql, { organizationId: orgId, limit: 20 });
    revalidatePath("/notifications");
    return result;
  }, "再送しました");
}

/** この店舗のリマインド（前日・当日）の対象を確認し、未送信の通知をまとめて処理する（通常は毎日の自動処理で行う） */
export async function runNotificationsNow(): Promise<ActionResult<{ processed: number }>> {
  return runAction(async () => {
    const ctx = await withAuth("notifications.view", async (_tx, ctx) => ctx);
    const sql = db();
    await enqueueReminders(sql, new Date(), { locationId: ctx.location.id });
    const result = await processNotifications(sql, { organizationId: ctx.organizationId, limit: 100 });
    revalidatePath("/notifications");
    return result;
  });
}
