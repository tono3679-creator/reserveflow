"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Pencil, UserPlus } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { Field } from "@/components/common/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { createCustomer, updateCustomer } from "@/lib/actions/customers";
import { customerFormSchema, type CustomerFormInput } from "@/lib/validation/booking";

type Initial = { id: string; name: string; nameKana: string | null; phone: string | null; email: string | null; preferredStaffId: string | null };

/** 顧客の登録（initial なし）・編集（initial あり）。ボタンとダイアログをまとめて出す */
export function CustomerFormDialog({ initial, staff }: { initial?: Initial; staff: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      {initial ? (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Pencil aria-hidden />編集</Button>
      ) : (
        <Button onClick={() => setOpen(true)}><UserPlus aria-hidden />顧客を登録</Button>
      )}
      {open && (
        <CustomerForm
          initial={initial}
          staff={staff}
          onClose={() => setOpen(false)}
          onSaved={(id) => { setOpen(false); if (initial) router.refresh(); else router.push(`/customers/${id}`); }}
        />
      )}
    </>
  );
}

function CustomerForm({ initial, staff, onClose, onSaved }: { initial?: Initial; staff: { id: string; name: string }[]; onClose: () => void; onSaved: (id: string) => void }) {
  const [pending, startTransition] = useTransition();
  const form = useForm<CustomerFormInput, unknown, z.output<typeof customerFormSchema>>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: {
      name: initial?.name ?? "", nameKana: initial?.nameKana ?? "", phone: initial?.phone ?? "", email: initial?.email ?? "",
      preferredStaffId: initial?.preferredStaffId ?? "",
    },
  });
  const errors = form.formState.errors;
  const onSubmit = form.handleSubmit(() =>
    startTransition(async () => {
      const values = form.getValues();
      const result = initial ? await updateCustomer(initial.id, values) : await createCustomer(values);
      if (!result.ok) {
        for (const [key, message] of Object.entries(result.fieldErrors ?? {})) form.setError(key as keyof CustomerFormInput, { message });
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      onSaved(initial ? initial.id : (result.data as { id: string }).id);
    }),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "顧客情報を編集" : "顧客を登録"}</DialogTitle>
          <DialogDescription>電話番号かメールアドレスがあると、予約の確認や連絡に使えます。</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="氏名" htmlFor="c-name" required error={errors.name?.message}>
              <Input id="c-name" autoComplete="off" aria-invalid={!!errors.name} {...form.register("name")} />
            </Field>
            <Field label="ふりがな" htmlFor="c-kana" error={errors.nameKana?.message}>
              <Input id="c-kana" autoComplete="off" aria-invalid={!!errors.nameKana} {...form.register("nameKana")} />
            </Field>
            <Field label="電話番号" htmlFor="c-phone" error={errors.phone?.message}>
              <Input id="c-phone" type="tel" inputMode="tel" aria-invalid={!!errors.phone} {...form.register("phone")} />
            </Field>
            <Field label="メールアドレス" htmlFor="c-email" error={errors.email?.message}>
              <Input id="c-email" type="email" aria-invalid={!!errors.email} {...form.register("email")} />
            </Field>
          </div>
          {staff.length > 0 && (
            <Field label="担当スタッフ" htmlFor="c-staff" error={errors.preferredStaffId?.message} hint="指名の多いスタッフなど。予約時の初期値になります。">
              <NativeSelect id="c-staff" {...form.register("preferredStaffId")}>
                <option value="">なし</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </NativeSelect>
            </Field>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>閉じる</Button>
            <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" aria-hidden />}{initial ? "保存する" : "登録する"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
