"use server";
import { revalidatePath } from "next/cache";
import { withAuth } from "@/lib/auth";
import type { Tx } from "@/lib/db";
import { bookingRulesSchema, businessHoursSchema, locationInfoSchema, segmentRulesSchema } from "@/lib/validation/settings";
import { suggestionWeightsSchema } from "@/lib/validation/suggestions";
import { runAction, UserFacingError, type ActionResult } from "./result";

/**
 * 店舗設定の変更（オーナーのみ）。
 * サーバーで権限を確かめ（withAuth）、さらに DB の RLS（locations / tenant_settings / business_hours はオーナーだけ更新可）が効く。
 */
export async function updateLocationInfo(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const v = locationInfoSchema.parse(input);
    await withAuth("settings.manage", async (tx, ctx) => {
      const rows = await tx`update public.locations
         set name = ${v.name}, phone = ${v.phone}, email = ${v.email}, address = ${v.address}, logo_url = ${v.logoUrl}, timezone = ${v.timezone}
       where id = ${ctx.location.id} returning id`;
      if (rows.length === 0) throw new UserFacingError("この店舗を変更する権限がありません");
      await audit(tx, ctx.organizationId, "location.update", ctx.location.id, { name: v.name });
    });
    revalidatePath("/", "layout");
  }, "店舗情報を保存しました");
}

export async function updateBusinessHours(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const v = businessHoursSchema.parse(input);
    await withAuth("settings.manage", async (tx, ctx) => {
      await tx`delete from public.business_hours where location_id = ${ctx.location.id}`;
      const rows = v.days.filter((d) => d.open).map((d) => ({
        organization_id: ctx.organizationId, location_id: ctx.location.id, weekday: d.weekday, opens_at: d.opensAt, closes_at: d.closesAt,
      }));
      if (rows.length > 0) await tx`insert into public.business_hours ${tx(rows)}`;
      await audit(tx, ctx.organizationId, "business_hours.update", ctx.location.id, { openDays: rows.length });
    });
    revalidatePath("/settings");
  }, "営業時間を保存しました");
}

export async function updateBookingRules(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const v = bookingRulesSchema.parse(input);
    await withAuth("settings.manage", async (tx, ctx) => {
      const rows = await tx`update public.tenant_settings set
          public_booking_enabled = ${v.publicBookingEnabled}, staff_selection = ${v.staffSelection},
          slot_interval_minutes = ${v.slotIntervalMinutes}, min_lead_minutes = ${v.minLeadMinutes},
          max_advance_days = ${v.maxAdvanceDays}, cancel_deadline_hours = ${v.cancelDeadlineHours},
          cancellation_policy = ${v.cancellationPolicy}, remind_day_before = ${v.remindDayBefore}, remind_same_day = ${v.remindSameDay}
        where location_id = ${ctx.location.id} returning location_id`;
      if (rows.length === 0) throw new UserFacingError("この店舗を変更する権限がありません");
      await audit(tx, ctx.organizationId, "tenant_settings.update", ctx.location.id, {});
    });
    revalidatePath("/settings");
  }, "予約受付の設定を保存しました");
}

export async function updateSegmentRules(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const v = segmentRulesSchema.parse(input);
    await withAuth("settings.manage", async (tx, ctx) => {
      const rows = await tx`update public.tenant_settings set
          segment_repeat_min_visits = ${v.repeatMinVisits}, segment_vip_min_visits = ${v.vipMinVisits},
          segment_vip_min_spend = ${v.vipMinSpend}, segment_dormant_days = ${v.dormantDays}
        where location_id = ${ctx.location.id} returning location_id`;
      if (rows.length === 0) throw new UserFacingError("この店舗を変更する権限がありません");
      await audit(tx, ctx.organizationId, "segment_rules.update", ctx.location.id, v);
    });
    revalidatePath("/settings");
    revalidatePath("/customers", "layout");
  }, "顧客セグメントの基準を保存しました");
}

/** スマート空き枠提案のスコアの重み */
export async function updateSuggestionWeights(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const v = suggestionWeightsSchema.parse(input);
    await withAuth("settings.manage", async (tx, ctx) => {
      const rows = await tx`update public.tenant_settings set
          weight_preferred_time = ${v.preferredTime}, weight_gap = ${v.gap}, weight_balance = ${v.balance}, weight_idle = ${v.idle}
        where location_id = ${ctx.location.id} returning location_id`;
      if (rows.length === 0) throw new UserFacingError("この店舗を変更する権限がありません");
      await audit(tx, ctx.organizationId, "suggestion_weights.update", ctx.location.id, v);
    });
    revalidatePath("/settings");
    revalidatePath("/suggestions");
  }, "空き枠提案の重みを保存しました");
}

/** 操作履歴（書き込みは DB 関数経由。利用者が直接 audit_logs に書く権限はない） */
async function audit(tx: Tx, org: string, action: string, targetId: string, details: Record<string, unknown>) {
  await tx`select public.write_audit_log(${org}, ${action}, 'location', ${targetId}, ${tx.json(details as never)}::jsonb)`;
}
