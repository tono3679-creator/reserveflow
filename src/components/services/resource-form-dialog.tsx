"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/common/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { saveResource } from "@/lib/actions/services";
import { RESOURCE_KINDS, resourceFormSchema, type ResourceFormInput } from "@/lib/validation/service";

type Initial = { id: string; name: string; kind: "room" | "seat" | "equipment"; isActive: boolean };

export function ResourceFormDialog({ initial }: { initial?: Initial }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<ResourceFormInput>({
    resolver: zodResolver(resourceFormSchema),
    defaultValues: { name: initial?.name ?? "", kind: initial?.kind ?? "room", isActive: initial?.isActive ?? true },
  });
  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await saveResource(initial?.id ?? null, values);
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.message);
      setOpen(false);
      if (!initial) form.reset();
      router.refresh();
    }),
  );
  return (
    <>
      {initial ? (
        <Button variant="ghost" size="icon-sm" aria-label={`${initial.name}を編集`} onClick={() => setOpen(true)}><Pencil /></Button>
      ) : (
        <Button variant="outline" onClick={() => setOpen(true)}><Plus aria-hidden />設備を追加</Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{initial ? "設備を編集" : "設備を追加"}</DialogTitle>
            <DialogDescription>部屋・ベッド・機材など、同じ時間に1件しか使えないものです。サービスの編集で「使う設備」に選びます。</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            <Field label="設備名" htmlFor="rs-name" required error={form.formState.errors.name?.message}>
              <Input id="rs-name" aria-invalid={!!form.formState.errors.name} {...form.register("name")} />
            </Field>
            <Field label="種類" htmlFor="rs-kind">
              <NativeSelect id="rs-kind" {...form.register("kind")}>
                {Object.entries(RESOURCE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </NativeSelect>
            </Field>
            {initial && (
              <Controller control={form.control} name="isActive" render={({ field }) => (
                <label className="flex items-center gap-2 text-sm"><Switch checked={field.value} onCheckedChange={field.onChange} aria-label="使用中" />{field.value ? "使用中" : "停止中（割り当てない）"}</label>
              )} />
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>閉じる</Button>
              <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" aria-hidden />}{initial ? "保存する" : "追加する"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
