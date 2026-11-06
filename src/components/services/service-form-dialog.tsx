"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { Field } from "@/components/common/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveService } from "@/lib/actions/services";
import { cn } from "@/lib/utils";
import { serviceFormSchema, type ServiceFormInput } from "@/lib/validation/service";
import { STAFF_COLORS } from "@/lib/validation/staff";

export type ServiceInitial = {
  id: string; name: string; category: string | null; description: string | null; price: number; durationMinutes: number;
  bufferBeforeMinutes: number; bufferAfterMinutes: number; color: string; isPublic: boolean; isActive: boolean; staffIds: string[]; resourceIds: string[];
};
type Choice = { id: string; name: string };

const num = { setValueAs: (v: string) => (v === "" ? Number.NaN : Number(v)) };

export function ServiceFormDialog({ initial, staff, resources, categories }: { initial?: ServiceInitial; staff: Choice[]; resources: Choice[]; categories: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {initial ? (
        <Button variant="ghost" size="icon-sm" aria-label={`${initial.name}を編集`} onClick={() => setOpen(true)}><Pencil /></Button>
      ) : (
        <Button onClick={() => setOpen(true)}><Plus aria-hidden />サービスを追加</Button>
      )}
      {open && <ServiceForm initial={initial} staff={staff} resources={resources} categories={categories} onClose={() => setOpen(false)} />}
    </>
  );
}

function CheckList({ legend, hint, items, value, onChange }: { legend: string; hint: string; items: Choice[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
        {items.map((s) => {
          const checked = value.includes(s.id);
          return (
            <label key={s.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
              <input type="checkbox" className="size-4 accent-primary" checked={checked} onChange={() => onChange(checked ? value.filter((x) => x !== s.id) : [...value, s.id])} />
              <span className="min-w-0 truncate">{s.name}</span>
            </label>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </fieldset>
  );
}

function ServiceForm({ initial, staff, resources, categories, onClose }: { initial?: ServiceInitial; staff: Choice[]; resources: Choice[]; categories: string[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<ServiceFormInput, unknown, z.output<typeof serviceFormSchema>>({
    resolver: zodResolver(serviceFormSchema),
    defaultValues: {
      name: initial?.name ?? "", category: initial?.category ?? "", description: initial?.description ?? "",
      price: initial?.price ?? 0, durationMinutes: initial?.durationMinutes ?? 60,
      bufferBeforeMinutes: initial?.bufferBeforeMinutes ?? 0, bufferAfterMinutes: initial?.bufferAfterMinutes ?? 0,
      color: initial?.color ?? STAFF_COLORS[0], isPublic: initial?.isPublic ?? true, isActive: initial?.isActive ?? true,
      staffIds: initial?.staffIds ?? staff.map((s) => s.id), resourceIds: initial?.resourceIds ?? [],
    },
  });
  const errors = form.formState.errors;
  const onSubmit = form.handleSubmit(() =>
    startTransition(async () => {
      const result = await saveService(initial?.id ?? null, form.getValues());
      if (!result.ok) {
        for (const [key, message] of Object.entries(result.fieldErrors ?? {})) form.setError(key as keyof ServiceFormInput, { message });
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      onClose();
      router.refresh();
    }),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? "サービスを編集" : "サービスを追加"}</DialogTitle>
          <DialogDescription>料金と所要時間は予約時の初期値になります。変更しても登録済みの予約の料金は変わりません。</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="サービス名" htmlFor="sv-name" required error={errors.name?.message}>
              <Input id="sv-name" aria-invalid={!!errors.name} {...form.register("name")} />
            </Field>
            <Field label="カテゴリ" htmlFor="sv-cat" error={errors.category?.message}>
              <Input id="sv-cat" list="sv-cat-list" {...form.register("category")} />
              <datalist id="sv-cat-list">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="料金（円）" htmlFor="sv-price" required error={errors.price?.message}>
              <Input id="sv-price" type="number" min={0} inputMode="numeric" aria-invalid={!!errors.price} {...form.register("price", num)} />
            </Field>
            <Field label="所要時間（分）" htmlFor="sv-dur" required error={errors.durationMinutes?.message}>
              <Input id="sv-dur" type="number" min={5} step={5} inputMode="numeric" aria-invalid={!!errors.durationMinutes} {...form.register("durationMinutes", num)} />
            </Field>
            <Field label="準備（分）" htmlFor="sv-bb" error={errors.bufferBeforeMinutes?.message}>
              <Input id="sv-bb" type="number" min={0} step={5} inputMode="numeric" {...form.register("bufferBeforeMinutes", num)} />
            </Field>
            <Field label="片付け（分）" htmlFor="sv-ba" error={errors.bufferAfterMinutes?.message}>
              <Input id="sv-ba" type="number" min={0} step={5} inputMode="numeric" {...form.register("bufferAfterMinutes", num)} />
            </Field>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">準備・片付けの時間はお客様には見えませんが、スタッフと設備の枠を使います（前後の予約と重ならないようにします）。</p>
          <Field label="説明" htmlFor="sv-desc" error={errors.description?.message} hint="Web予約のページに表示されます">
            <Textarea id="sv-desc" rows={2} {...form.register("description")} />
          </Field>
          {staff.length > 0 && (
            <Controller control={form.control} name="staffIds" render={({ field }) => (
              <CheckList legend="担当できるスタッフ" hint="誰も選ばないと、スタッフ指名のある店舗ではこのサービスを予約できません。" items={staff} value={field.value} onChange={field.onChange} />
            )} />
          )}
          {resources.length > 0 && (
            <Controller control={form.control} name="resourceIds" render={({ field }) => (
              <CheckList legend="使う設備（どれか1つ）" hint="選んだ設備のうち空いているものを自動で割り当てます。設備が不要なら選びません。" items={resources} value={field.value} onChange={field.onChange} />
            )} />
          )}
          <Controller control={form.control} name="color" render={({ field }) => (
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">カレンダーの色（担当スタッフがいない予約で使います）</legend>
              <div className="flex flex-wrap gap-2">
                {STAFF_COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => field.onChange(c)} aria-label={`色 ${c}`} aria-pressed={field.value === c}
                    className={cn("flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-card", field.value === c && "ring-2 ring-ring")} style={{ backgroundColor: c }}>
                    {field.value === c && <Check className="size-4 text-white" aria-hidden />}
                  </button>
                ))}
              </div>
            </fieldset>
          )} />
          <div className="flex flex-wrap gap-6">
            <Controller control={form.control} name="isPublic" render={({ field }) => (
              <label className="flex items-center gap-2 text-sm"><Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Web予約に表示" />Web予約に表示</label>
            )} />
            <Controller control={form.control} name="isActive" render={({ field }) => (
              <label className="flex items-center gap-2 text-sm"><Switch checked={field.value} onCheckedChange={field.onChange} aria-label="提供中" />{field.value ? "提供中" : "停止中"}</label>
            )} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>閉じる</Button>
            <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" aria-hidden />}{initial ? "保存する" : "追加する"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
