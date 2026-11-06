"use server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { withAuth, type AppContext } from "@/lib/auth";
import { db, type Tx } from "@/lib/db";
import { processNotifications } from "@/lib/notifications/process";
import { checkSlot, isBlocking } from "@/lib/scheduling/engine";
import { loadSchedulingContext, loadServiceSpecs } from "@/lib/scheduling/load";
import { localDate, zonedDateTime } from "@/lib/time";
import { bookingFormSchema, moveBookingSchema, statusChangeSchema, type BookingFormInput } from "@/lib/validation/booking";
import { NeedsConfirmation, runAction, UserFacingError, type ActionResult } from "./result";

/**
 * 予約の登録・変更の前に、空き枠エンジンで同じ条件を確かめる。
 *   重なり・設備の不足・担当外 … 登録できない（DB でも必ず拒否される）
 *   営業時間外・勤務時間外・休憩・休暇 … 確認すれば登録できる（店舗の判断で受けることがあるため）
 */
async function validateSlot(
  tx: Tx, ctx: AppContext,
  slot: { serviceId: string; staffId: string | null; start: Date; end: Date; excludeBookingId?: string; confirmWarnings: boolean },
) {
  const date = localDate(slot.start, ctx.location.timezone);
  const [scheduling, services] = await Promise.all([
    loadSchedulingContext(tx, ctx.location.id, date, date),
    loadServiceSpecs(tx, ctx.location.id),
  ]);
  const service = services.find((s) => s.id === slot.serviceId);
  if (!scheduling || !service) throw new UserFacingError("このサービスは選べません（利用停止中か、別の店舗のサービスです）");
  const issues = checkSlot(scheduling, service, {
    staffId: slot.staffId, start: slot.start.getTime(), end: slot.end.getTime(), excludeBookingId: slot.excludeBookingId,
  });
  const blocking = issues.filter(isBlocking);
  if (blocking.length > 0) throw new UserFacingError(blocking.map((i) => i.message).join("。"));
  if (issues.length > 0 && !slot.confirmWarnings) throw new NeedsConfirmation(issues.map((i) => i.message));
}

function toRange(ctx: AppContext, v: BookingFormInput) {
  return {
    start: zonedDateTime(v.date, v.startTime, ctx.location.timezone),
    end: zonedDateTime(v.date, v.endTime, ctx.location.timezone),
  };
}

function refresh() {
  // 予約の変更で作られた通知イベントを、応答を返したあとに送る（送れなくても定期実行で再試行する）
  after(() => processNotifications(db(), { limit: 20 }).catch((e) => console.error("notify", e)));
  revalidatePath("/notifications");
  revalidatePath("/calendar");
  revalidatePath("/bookings", "layout");
  revalidatePath("/dashboard");
  revalidatePath("/customers", "layout");
}

export async function createBooking(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const v = bookingFormSchema.parse(input);
    const id = await withAuth("bookings.manage", async (tx, ctx) => {
      const { start, end } = toRange(ctx, v);
      await validateSlot(tx, ctx, { serviceId: v.serviceId, staffId: v.staffId, start, end, confirmWarnings: v.confirmWarnings });
      const [row] = await tx<{ id: string }[]>`
        select public.create_booking(${ctx.location.id}, ${v.customerId}, ${v.serviceId}, ${v.staffId}, ${start}, ${end},
          ${v.price}, ${v.notes}, ${v.status}, 'admin') id`;
      return row.id;
    });
    refresh();
    return { id };
  }, "予約を登録しました");
}

export async function updateBooking(bookingId: string, version: number, input: unknown): Promise<ActionResult<{ version: number }>> {
  return runAction(async () => {
    const v = bookingFormSchema.parse(input);
    const next = await withAuth("bookings.manage", async (tx, ctx) => {
      const { start, end } = toRange(ctx, v);
      await validateSlot(tx, ctx, { serviceId: v.serviceId, staffId: v.staffId, start, end, excludeBookingId: bookingId, confirmWarnings: v.confirmWarnings });
      const [row] = await tx<{ v: number }[]>`
        select public.update_booking(${bookingId}, ${version}, ${v.customerId}, ${v.serviceId}, ${v.staffId}, ${start}, ${end},
          ${v.price}, ${v.notes}) v`;
      return row.v;
    });
    refresh();
    return { version: next };
  }, "予約を変更しました");
}

/** カレンダーのドラッグ：日時・担当だけを変える（ほかの内容はそのまま） */
export async function moveBooking(input: unknown): Promise<ActionResult<{ version: number }>> {
  return runAction(async () => {
    const v = moveBookingSchema.parse(input);
    const next = await withAuth("bookings.manage", async (tx, ctx) => {
      const [b] = await tx<{ customer_id: string; service_id: string; staff_id: string | null; price: number; notes: string | null; location_id: string }[]>`
        select customer_id, service_id, staff_id, price, notes, location_id from public.bookings where id = ${v.bookingId}`;
      if (!b || b.location_id !== ctx.location.id) throw new UserFacingError("予約が見つかりません");
      const staffId = v.staffId === undefined ? b.staff_id : v.staffId;
      const start = new Date(v.startsAt);
      const end = new Date(v.endsAt);
      await validateSlot(tx, ctx, { serviceId: b.service_id, staffId, start, end, excludeBookingId: v.bookingId, confirmWarnings: v.confirmWarnings });
      const [row] = await tx<{ v: number }[]>`
        select public.update_booking(${v.bookingId}, ${v.version}, ${b.customer_id}, ${b.service_id}, ${staffId}, ${start}, ${end},
          ${b.price}, ${b.notes ?? ""}) v`;
      return row.v;
    });
    refresh();
    return { version: next };
  }, "予約の日時を変更しました");
}

export async function changeBookingStatus(input: unknown): Promise<ActionResult<{ version: number }>> {
  return runAction(async () => {
    const v = statusChangeSchema.parse(input);
    const next = await withAuth("bookings.updateStatus", async (tx) => {
      const [row] = await tx<{ v: number }[]>`select public.set_booking_status(${v.bookingId}, ${v.version}, ${v.status}, ${v.reason}) v`;
      return row.v;
    });
    refresh();
    return { version: next };
  }, "ステータスを変更しました");
}
