"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAuth, type AppContext } from "@/lib/auth";
import type { Tx } from "@/lib/db";
import { localDate } from "@/lib/time";
import { staffFormSchema, staffScheduleSchema, timeOffSchema } from "@/lib/validation/staff";
import { runAction, UserFacingError, type ActionResult } from "./result";

/**
 * スタッフの管理。
 *   登録・基本情報・担当サービス … オーナー（staff.manage）
 *   勤務時間・休暇            … オーナー・マネージャー（staff.schedule）
 * どちらも DB の RLS が同じ範囲に制限している。
 */
function refresh(id?: string) {
  revalidatePath("/staff");
  if (id) revalidatePath(`/staff/${id}`);
  revalidatePath("/calendar");
}

async function ensureStaff(tx: Tx, ctx: AppContext, staffId: string) {
  const [row] = await tx<{ id: string }[]>`select id from public.staff where id = ${staffId} and location_id = ${ctx.location.id}`;
  if (!row) throw new UserFacingError("スタッフが見つかりません");
}

async function setServices(tx: Tx, ctx: AppContext, staffId: string, serviceIds: string[]) {
  // 別の店舗のサービスは選べない
  const valid = serviceIds.length === 0 ? [] : await tx<{ id: string }[]>`
    select id from public.services where location_id = ${ctx.location.id} and id = any (${serviceIds}::uuid[])`;
  if (valid.length !== new Set(serviceIds).size) throw new UserFacingError("選べないサービスが含まれています");
  await tx`delete from public.service_staff where staff_id = ${staffId}`;
  if (valid.length > 0) {
    await tx`insert into public.service_staff ${tx(valid.map((s) => ({ organization_id: ctx.organizationId, service_id: s.id, staff_id: staffId })))}`;
  }
}

export async function createStaff(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const v = staffFormSchema.parse(input);
    const id = await withAuth("staff.manage", async (tx, ctx) => {
      const [{ n }] = await tx<{ n: number }[]>`select coalesce(max(sort_order), 0) + 1 n from public.staff where location_id = ${ctx.location.id}`;
      const [row] = await tx<{ id: string }[]>`
        insert into public.staff (organization_id, location_id, name, title, email, color, is_active, sort_order)
        values (${ctx.organizationId}, ${ctx.location.id}, ${v.name}, ${v.title}, ${v.email}, ${v.color}, ${v.isActive}, ${n}) returning id`;
      await setServices(tx, ctx, row.id, v.serviceIds);
      await tx`select public.write_audit_log(${ctx.organizationId}, 'staff.create', 'staff', ${row.id}, '{}'::jsonb)`;
      return row.id;
    });
    refresh();
    return { id };
  }, "スタッフを登録しました");
}

export async function updateStaff(staffId: string, input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const id = z.uuid().parse(staffId);
    const v = staffFormSchema.parse(input);
    await withAuth("staff.manage", async (tx, ctx) => {
      await ensureStaff(tx, ctx, id);
      if (!v.isActive) {
        const [{ n }] = await tx<{ n: number }[]>`
          select count(*)::int n from public.bookings where staff_id = ${id} and starts_at > now() and public.booking_blocks_slot(status)`;
        if (n > 0) throw new UserFacingError(`今後の予約が${n}件あるため停止できません。予約の担当を変えてから停止してください。`);
      }
      await tx`update public.staff set name = ${v.name}, title = ${v.title}, email = ${v.email}, color = ${v.color}, is_active = ${v.isActive} where id = ${id}`;
      await setServices(tx, ctx, id, v.serviceIds);
      await tx`select public.write_audit_log(${ctx.organizationId}, 'staff.update', 'staff', ${id}, ${tx.json({ isActive: v.isActive })}::jsonb)`;
    });
    refresh(id);
  }, "スタッフ情報を保存しました");
}

export async function updateStaffSchedule(staffId: string, input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const id = z.uuid().parse(staffId);
    const v = staffScheduleSchema.parse(input);
    await withAuth("staff.schedule", async (tx, ctx) => {
      await ensureStaff(tx, ctx, id);
      await tx`delete from public.staff_schedules where staff_id = ${id}`;
      const rows = v.days.filter((d) => d.working).map((d) => ({
        organization_id: ctx.organizationId, staff_id: id, weekday: d.weekday, starts_at: d.start, ends_at: d.end,
        break_starts_at: d.breakStart, break_ends_at: d.breakEnd,
      }));
      if (rows.length > 0) await tx`insert into public.staff_schedules ${tx(rows)}`;
      await tx`select public.write_audit_log(${ctx.organizationId}, 'staff.schedule', 'staff', ${id}, ${tx.json({ days: rows.length })}::jsonb)`;
    });
    refresh(id);
  }, "勤務時間を保存しました");
}

export async function addTimeOff(staffId: string, input: unknown): Promise<ActionResult<{ affected: number }>> {
  return runAction(async () => {
    const id = z.uuid().parse(staffId);
    const v = timeOffSchema.parse(input);
    const affected = await withAuth("staff.schedule", async (tx, ctx) => {
      await ensureStaff(tx, ctx, id);
      if (v.date < localDate(new Date(), ctx.location.timezone)) throw new UserFacingError("過去の日付には登録できません");
      await tx`
        insert into public.staff_time_off (organization_id, staff_id, date, kind, starts_at, ends_at, reason)
        values (${ctx.organizationId}, ${id}, ${v.date}, ${v.kind}, ${v.kind === "custom_hours" ? v.start : null}, ${v.kind === "custom_hours" ? v.end : null}, ${v.reason})
        on conflict (staff_id, date) do update set kind = excluded.kind, starts_at = excluded.starts_at, ends_at = excluded.ends_at, reason = excluded.reason`;
      await tx`select public.write_audit_log(${ctx.organizationId}, 'staff.time_off', 'staff', ${id}, ${tx.json({ date: v.date, kind: v.kind })}::jsonb)`;
      // その日に入っている予約の件数（休暇を入れても予約は自動では動かさない。画面で知らせる）
      const [{ n }] = await tx<{ n: number }[]>`
        select count(*)::int n from public.bookings b join public.locations l on l.id = b.location_id
         where b.staff_id = ${id} and public.booking_blocks_slot(b.status) and (b.starts_at at time zone l.timezone)::date = ${v.date}::date`;
      return n;
    });
    refresh(id);
    return { affected };
  }, "休暇・勤務変更を登録しました");
}

export async function deleteTimeOff(timeOffId: string, staffId: string): Promise<ActionResult> {
  return runAction(async () => {
    const id = z.uuid().parse(timeOffId);
    const sid = z.uuid().parse(staffId);
    await withAuth("staff.schedule", async (tx, ctx) => {
      await ensureStaff(tx, ctx, sid);
      const rows = await tx`delete from public.staff_time_off where id = ${id} and staff_id = ${sid} returning id`;
      if (rows.length === 0) throw new UserFacingError("この休暇は見つかりません");
    });
    refresh(sid);
  }, "休暇・勤務変更を削除しました");
}
