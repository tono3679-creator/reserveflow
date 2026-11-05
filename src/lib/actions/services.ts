"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAuth, type AppContext } from "@/lib/auth";
import type { Tx } from "@/lib/db";
import { resourceFormSchema, serviceFormSchema } from "@/lib/validation/service";
import { runAction, UserFacingError, type ActionResult } from "./result";

/** サービス（メニュー）と設備の管理。オーナーのみ（RLS も同じ） */
function refresh() {
  revalidatePath("/services");
  revalidatePath("/calendar");
  revalidatePath("/staff", "layout");
}

async function checkIds(tx: Tx, ctx: AppContext, table: "staff" | "resources", ids: string[]) {
  if (ids.length === 0) return;
  const rows = table === "staff"
    ? await tx`select id from public.staff where location_id = ${ctx.location.id} and id = any (${ids}::uuid[])`
    : await tx`select id from public.resources where location_id = ${ctx.location.id} and id = any (${ids}::uuid[])`;
  if (rows.length !== new Set(ids).size) throw new UserFacingError("選べない項目が含まれています");
}

async function setLinks(tx: Tx, ctx: AppContext, serviceId: string, staffIds: string[], resourceIds: string[]) {
  await checkIds(tx, ctx, "staff", staffIds);
  await checkIds(tx, ctx, "resources", resourceIds);
  await tx`delete from public.service_staff where service_id = ${serviceId}`;
  await tx`delete from public.service_resources where service_id = ${serviceId}`;
  const org = ctx.organizationId;
  if (staffIds.length) await tx`insert into public.service_staff ${tx([...new Set(staffIds)].map((s) => ({ organization_id: org, service_id: serviceId, staff_id: s })))}`;
  if (resourceIds.length) await tx`insert into public.service_resources ${tx([...new Set(resourceIds)].map((r) => ({ organization_id: org, service_id: serviceId, resource_id: r })))}`;
}

export async function saveService(serviceId: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const id = serviceId === null ? null : z.uuid().parse(serviceId);
    const v = serviceFormSchema.parse(input);
    const saved = await withAuth("services.manage", async (tx, ctx) => {
      let target = id;
      if (target) {
        const rows = await tx`update public.services set name = ${v.name}, category = ${v.category}, description = ${v.description}, price = ${v.price},
            duration_minutes = ${v.durationMinutes}, buffer_before_minutes = ${v.bufferBeforeMinutes}, buffer_after_minutes = ${v.bufferAfterMinutes},
            color = ${v.color}, is_public = ${v.isPublic}, is_active = ${v.isActive}
          where id = ${target} and location_id = ${ctx.location.id} returning id`;
        if (rows.length === 0) throw new UserFacingError("サービスが見つかりません");
      } else {
        const [{ n }] = await tx<{ n: number }[]>`select coalesce(max(sort_order), 0) + 1 n from public.services where location_id = ${ctx.location.id}`;
        const [row] = await tx<{ id: string }[]>`
          insert into public.services (organization_id, location_id, name, category, description, price, duration_minutes,
            buffer_before_minutes, buffer_after_minutes, color, is_public, is_active, sort_order)
          values (${ctx.organizationId}, ${ctx.location.id}, ${v.name}, ${v.category}, ${v.description}, ${v.price}, ${v.durationMinutes},
            ${v.bufferBeforeMinutes}, ${v.bufferAfterMinutes}, ${v.color}, ${v.isPublic}, ${v.isActive}, ${n}) returning id`;
        target = row.id;
      }
      await setLinks(tx, ctx, target, v.staffIds, v.resourceIds);
      await tx`select public.write_audit_log(${ctx.organizationId}, ${id ? "service.update" : "service.create"}, 'service', ${target}, '{}'::jsonb)`;
      return target;
    });
    refresh();
    return { id: saved };
  }, serviceId ? "サービスを保存しました" : "サービスを追加しました");
}

/** 予約のないサービスだけ削除できる（予約があるものは「停止」にする） */
export async function deleteService(serviceId: string): Promise<ActionResult> {
  return runAction(async () => {
    const id = z.uuid().parse(serviceId);
    await withAuth("services.manage", async (tx, ctx) => {
      const [{ n }] = await tx<{ n: number }[]>`select count(*)::int n from public.bookings where service_id = ${id}`;
      if (n > 0) throw new UserFacingError(`予約が${n}件あるため削除できません。新しい予約を受けないようにするには「停止」にしてください。`);
      const rows = await tx`delete from public.services where id = ${id} and location_id = ${ctx.location.id} returning id`;
      if (rows.length === 0) throw new UserFacingError("サービスが見つかりません");
      await tx`select public.write_audit_log(${ctx.organizationId}, 'service.delete', 'service', ${id}, '{}'::jsonb)`;
    });
    refresh();
  }, "サービスを削除しました");
}

export async function saveResource(resourceId: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const id = resourceId === null ? null : z.uuid().parse(resourceId);
    const v = resourceFormSchema.parse(input);
    const saved = await withAuth("services.manage", async (tx, ctx) => {
      if (id) {
        if (!v.isActive) {
          const [{ n }] = await tx<{ n: number }[]>`
            select count(*)::int n from public.booking_resources br join public.bookings b on b.id = br.booking_id
             where br.resource_id = ${id} and br.is_active and b.starts_at > now()`;
          if (n > 0) throw new UserFacingError(`この設備を使う今後の予約が${n}件あるため停止できません。`);
        }
        const rows = await tx`update public.resources set name = ${v.name}, kind = ${v.kind}, is_active = ${v.isActive}
          where id = ${id} and location_id = ${ctx.location.id} returning id`;
        if (rows.length === 0) throw new UserFacingError("設備が見つかりません");
        await tx`select public.write_audit_log(${ctx.organizationId}, 'resource.update', 'resource', ${id}, '{}'::jsonb)`;
        return id;
      }
      const [{ n }] = await tx<{ n: number }[]>`select coalesce(max(sort_order), 0) + 1 n from public.resources where location_id = ${ctx.location.id}`;
      const [row] = await tx<{ id: string }[]>`
        insert into public.resources (organization_id, location_id, name, kind, is_active, sort_order)
        values (${ctx.organizationId}, ${ctx.location.id}, ${v.name}, ${v.kind}, ${v.isActive}, ${n}) returning id`;
      await tx`select public.write_audit_log(${ctx.organizationId}, 'resource.create', 'resource', ${row.id}, '{}'::jsonb)`;
      return row.id;
    });
    refresh();
    return { id: saved };
  }, resourceId ? "設備を保存しました" : "設備を追加しました");
}

export async function deleteResource(resourceId: string): Promise<ActionResult> {
  return runAction(async () => {
    const id = z.uuid().parse(resourceId);
    await withAuth("services.manage", async (tx, ctx) => {
      const [{ n }] = await tx<{ n: number }[]>`select count(*)::int n from public.booking_resources where resource_id = ${id}`;
      if (n > 0) throw new UserFacingError(`この設備を使った予約が${n}件あるため削除できません。使わない場合は「停止」にしてください。`);
      const rows = await tx`delete from public.resources where id = ${id} and location_id = ${ctx.location.id} returning id`;
      if (rows.length === 0) throw new UserFacingError("設備が見つかりません");
      await tx`select public.write_audit_log(${ctx.organizationId}, 'resource.delete', 'resource', ${id}, '{}'::jsonb)`;
    });
    refresh();
  }, "設備を削除しました");
}
