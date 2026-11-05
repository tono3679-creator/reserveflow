"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Loader2, Pencil, UserPlus } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { Field } from "@/components/common/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { createStaff, updateStaff } from "@/lib/actions/staff";
import { cn } from "@/lib/utils";
import { STAFF_COLORS, staffFormSchema, type StaffFormInput } from "@/lib/validation/staff";

type Initial = { id: string; name: string; title: string | null; email: string | null; color: string; isActive: boolean; serviceIds: string[] };
type ServiceChoice = { id: string; name: string; category: string | null };

/** スタッフの登録・編集（オーナーのみ）。担当できるサービスもここで選ぶ */
export function StaffFormDialog({ initial, services }: { initial?: Initial; services: ServiceChoice[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      {initial ? (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Pencil aria-hidden />基本情報・担当サービスを編集</Button>
      ) : (
        <Button onClick={() => setOpen(true)}><UserPlus aria-hidden />スタッフを追加</Button>
      )}
      {open && (
        <StaffForm initial={initial} services={services} onClose={() => setOpen(false)}
          onSaved={(id) => { setOpen(false); if (initial) router.refresh(); else router.push(`/staff/${id}`); }} />
      )}
    </>
  );
}

function StaffForm({ initial, services, onClose, onSaved }: { initial?: Initial; services: ServiceChoice[]; onClose: () => void; onSaved: (id: string) => void }) {
  const [pending, startTransition] = useTransition();
  const form = useForm<StaffFormInput, unknown, z.output<typeof staffFormSchema>>({
    resolver: zodResolver(staffFormSchema),
    defaultValues: {
      name: initial?.name ?? "", title: initial?.title ?? "", email: initial?.email ?? "",
      color: initial?.color ?? STAFF_COLORS[0], isActive: initial?.isActive ?? true,
      // 新しいスタッフは全サービスを担当する状態から始める
      serviceIds: initial?.serviceIds ?? services.map((s) => s.id),
    },
  });
  const errors = form.formState.errors;
  const onSubmit = form.handleSubmit(() =>
    startTransition(async () => {
      const values = form.getValues();
      const result = initial ? await updateStaff(initial.id, values) : await createStaff(values);
      if (!result.ok) {
        for (const [key, message] of Object.entries(result.fieldErrors ?? {})) form.setError(key as keyof StaffFormInput, { message });
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      onSaved(initial ? initial.id : (result.data as { id: string }).id);
    }),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "スタッフを編集" : "スタッフを追加"}</DialogTitle>
          <DialogDescription>勤務時間は追加したあと、スタッフの詳細画面で設定します。</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="氏名" htmlFor="s-name" required error={errors.name?.message}>
              <Input id="s-name" aria-invalid={!!errors.name} {...form.register("name")} />
            </Field>
            <Field label="肩書き" htmlFor="s-title" error={errors.title?.message} hint="スタイリスト・トレーナーなど">
              <Input id="s-title" aria-invalid={!!errors.title} {...form.register("title")} />
            </Field>
          </div>
          <Field label="メールアドレス" htmlFor="s-email" error={errors.email?.message}>
            <Input id="s-email" type="email" aria-invalid={!!errors.email} {...form.register("email")} />
          </Field>
          <Controller control={form.control} name="color" render={({ field }) => (
            <fieldset className="grid gap-1.5">
              <legend className="mb-1.5 text-sm font-medium">カレンダーの色</legend>
              <div className="flex flex-wrap gap-2">
                {STAFF_COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => field.onChange(c)} aria-label={`色 ${c}`} aria-pressed={field.value === c}
                    className={cn("flex size-8 items-center justify-center rounded-full ring-offset-2 ring-offset-card", field.value === c && "ring-2 ring-ring")}
                    style={{ backgroundColor: c }}>
                    {field.value === c && <Check className="size-4 text-white" aria-hidden />}
                  </button>
                ))}
              </div>
            </fieldset>
          )} />
          {services.length > 0 && (
            <Controller control={form.control} name="serviceIds" render={({ field }) => (
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">担当できるサービス</legend>
                <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
                  {services.map((s) => {
                    const checked = field.value.includes(s.id);
                    return (
                      <label key={s.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                        <input type="checkbox" className="size-4 accent-primary" checked={checked}
                          onChange={() => field.onChange(checked ? field.value.filter((x) => x !== s.id) : [...field.value, s.id])} />
                        <span className="min-w-0 truncate">{s.name}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )} />
          )}
          {initial && (
            <Controller control={form.control} name="isActive" render={({ field }) => (
              <label className="flex items-center gap-3 text-sm">
                <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="在籍中" />
                <span>{field.value ? "在籍中（予約を受け付ける）" : "停止中（予約の選択肢に出さない）"}</span>
              </label>
            )} />
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>閉じる</Button>
            <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" aria-hidden />}{initial ? "保存する" : "追加する"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
