"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAuth } from "@/lib/auth";
import { customerFormSchema } from "@/lib/validation/booking";
import { runAction, UserFacingError, type ActionResult } from "./result";

export type CustomerOption = { id: string; name: string; nameKana: string | null; phone: string | null; email: string | null };

function likePattern(q: string) {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/** 予約フォームの顧客検索（氏名・カナ・電話・メールの部分一致。RLS で見える顧客だけ） */
export async function searchCustomers(query: string): Promise<ActionResult<CustomerOption[]>> {
  return runAction(async () => {
    const q = z.string().trim().max(60).parse(query);
    return withAuth(undefined, async (tx, ctx) => {
      const rows = await tx<{ id: string; name: string; name_kana: string | null; phone: string | null; email: string | null }[]>`
        select id, name, name_kana, phone, email from public.customers
         where organization_id = ${ctx.organizationId}
           ${q ? tx`and (name ilike ${likePattern(q)} or name_kana ilike ${likePattern(q)} or phone ilike ${likePattern(q)} or email ilike ${likePattern(q)})` : tx``}
         order by updated_at desc limit 20`;
      return rows.map((r) => ({ id: r.id, name: r.name, nameKana: r.name_kana, phone: r.phone, email: r.email }));
    });
  });
}

export async function createCustomer(input: unknown): Promise<ActionResult<CustomerOption>> {
  return runAction(async () => {
    const v = customerFormSchema.parse(input);
    const row = await withAuth("customers.manage", async (tx, ctx) => {
      const [r] = await tx<{ id: string }[]>`
        insert into public.customers (organization_id, name, name_kana, phone, email, preferred_staff_id)
        values (${ctx.organizationId}, ${v.name}, ${v.nameKana}, ${v.phone}, ${v.email}, ${v.preferredStaffId}) returning id`;
      await tx`select public.write_audit_log(${ctx.organizationId}, 'customer.create', 'customer', ${r.id}, '{}'::jsonb)`;
      return r;
    });
    revalidatePath("/customers");
    return { id: row.id, name: v.name, nameKana: v.nameKana, phone: v.phone, email: v.email };
  }, "顧客を登録しました");
}

export async function updateCustomer(customerId: string, input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const id = z.uuid().parse(customerId);
    const v = customerFormSchema.parse(input);
    await withAuth("customers.manage", async (tx, ctx) => {
      const rows = await tx`update public.customers set name = ${v.name}, name_kana = ${v.nameKana}, phone = ${v.phone}, email = ${v.email},
          preferred_staff_id = ${v.preferredStaffId}
        where id = ${id} and organization_id = ${ctx.organizationId} returning id`;
      if (rows.length === 0) throw new UserFacingError("顧客が見つかりません");
      await tx`select public.write_audit_log(${ctx.organizationId}, 'customer.update', 'customer', ${id}, '{}'::jsonb)`;
    });
    revalidatePath(`/customers/${id}`);
    revalidatePath("/customers");
  }, "顧客情報を保存しました");
}

/** 予約のない顧客だけ削除できる（予約の履歴を残すため） */
export async function deleteCustomer(customerId: string): Promise<ActionResult> {
  return runAction(async () => {
    const id = z.uuid().parse(customerId);
    await withAuth("customers.manage", async (tx, ctx) => {
      const [{ n }] = await tx<{ n: number }[]>`select count(*)::int n from public.bookings where customer_id = ${id}`;
      if (n > 0) throw new UserFacingError(`予約が${n}件あるため削除できません。予約の履歴を残すため、予約のある顧客は削除できません。`);
      const rows = await tx`delete from public.customers where id = ${id} and organization_id = ${ctx.organizationId} returning id`;
      if (rows.length === 0) throw new UserFacingError("顧客が見つかりません");
      await tx`select public.write_audit_log(${ctx.organizationId}, 'customer.delete', 'customer', ${id}, '{}'::jsonb)`;
    });
    revalidatePath("/customers");
  }, "顧客を削除しました");
}

const noteSchema = z.object({ customerId: z.uuid(), body: z.string().trim().min(1, "メモを入力してください").max(2000, "2000文字以内で入力してください") });

export async function addCustomerNote(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const v = noteSchema.parse(input);
    await withAuth(undefined, async (tx, ctx) => {
      await tx`insert into public.customer_notes (organization_id, customer_id, author_member_id, body)
        values (${ctx.organizationId}, ${v.customerId}, ${ctx.memberId}, ${v.body})`;
    });
    revalidatePath(`/customers/${v.customerId}`);
  }, "メモを追加しました");
}

export async function deleteCustomerNote(noteId: string, customerId: string): Promise<ActionResult> {
  return runAction(async () => {
    const id = z.uuid().parse(noteId);
    await withAuth(undefined, async (tx) => {
      const rows = await tx`delete from public.customer_notes where id = ${id} returning id`;
      if (rows.length === 0) throw new UserFacingError("このメモは削除できません（ご自身のメモか、マネージャー以上の権限が必要です）");
    });
    revalidatePath(`/customers/${z.uuid().parse(customerId)}`);
  }, "メモを削除しました");
}
