"use client";
import { useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/common/form-field";
import { CustomerPicker } from "@/components/customers/customer-picker";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { createBooking, updateBooking } from "@/lib/actions/bookings";
import type { CustomerOption } from "@/lib/actions/customers";
import type { BookingOptions } from "@/lib/data/bookings";
import { STATUS_LABELS } from "@/lib/domain/booking";
import { formatYen } from "@/lib/format";
import { fromMinutes, toMinutes } from "@/lib/time";
import { bookingFormSchema, type BookingFormInput } from "@/lib/validation/booking";

export type BookingFormInitial = {
  bookingId?: string;
  version?: number;
  customer?: CustomerOption | null;
  serviceId?: string;
  staffId?: string | null;
  date: string;
  startTime: string;
  endTime?: string;
  price?: number;
  notes?: string | null;
};

function addMinutes(time: string, minutes: number): string {
  return fromMinutes(Math.min(toMinutes(time) + minutes, 23 * 60 + 59));
}

/**
 * 予約の登録・編集。サービスを選ぶと所要時間と料金が自動で入る。
 * 営業時間外・勤務時間外などはサーバーが警告を返し、確認すれば登録できる。重なりはサーバーと DB が拒否する。
 * 初期値はマウント時にだけ読むので、開くたびに呼び出し側でマウントし直す（条件付きで描画するか key を変える）。
 */
export function BookingFormDialog({
  open, onOpenChange, options, initial, onSaved, canCreateCustomer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: BookingOptions;
  initial: BookingFormInitial;
  onSaved?: (bookingId: string) => void;
  canCreateCustomer: boolean;
}) {
  const editing = !!initial.bookingId;
  const [customer, setCustomer] = useState<CustomerOption | null>(initial.customer ?? null);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [pending, startTransition] = useTransition();
  const firstService = options.services.find((s) => s.id === initial.serviceId) ?? null;

  const form = useForm<BookingFormInput>({
    resolver: zodResolver(bookingFormSchema),
    defaultValues: defaults(),
  });

  function defaults(): BookingFormInput {
    return {
      customerId: initial.customer?.id ?? "",
      serviceId: initial.serviceId ?? "",
      staffId: initial.staffId ?? null,
      date: initial.date,
      startTime: initial.startTime,
      endTime: initial.endTime ?? addMinutes(initial.startTime, firstService?.durationMinutes ?? 60),
      price: initial.price ?? firstService?.price ?? 0,
      notes: initial.notes ?? "",
      status: "confirmed",
      confirmWarnings: false,
    };
  }

  const serviceId = useWatch({ control: form.control, name: "serviceId" });
  const startTime = useWatch({ control: form.control, name: "startTime" });
  const service = options.services.find((s) => s.id === serviceId);
  const staffChoices = options.staff.filter((s) => !service || service.staffIds.includes(s.id));

  const onServiceChange = (id: string) => {
    form.setValue("serviceId", id, { shouldDirty: true, shouldValidate: true });
    const s = options.services.find((x) => x.id === id);
    if (!s) return;
    form.setValue("price", s.price, { shouldDirty: true });
    form.setValue("endTime", addMinutes(form.getValues("startTime"), s.durationMinutes), { shouldDirty: true });
    const staffId = form.getValues("staffId");
    if (staffId && !s.staffIds.includes(staffId)) form.setValue("staffId", null);
  };
  const onStartChange = (time: string) => {
    form.setValue("startTime", time, { shouldDirty: true, shouldValidate: true });
    if (service && /^\d{2}:\d{2}$/.test(time)) form.setValue("endTime", addMinutes(time, service.durationMinutes), { shouldDirty: true });
  };

  const submit = (confirmWarnings: boolean) =>
    form.handleSubmit((values) =>
      startTransition(async () => {
        const payload = { ...values, confirmWarnings };
        const result = editing
          ? await updateBooking(initial.bookingId!, initial.version!, payload)
          : await createBooking(payload);
        if (!result.ok) {
          if (result.warnings) {
            setWarnings(result.warnings);
            return;
          }
          for (const [key, message] of Object.entries(result.fieldErrors ?? {})) form.setError(key as keyof BookingFormInput, { message });
          toast.error(result.error);
          return;
        }
        setWarnings(null);
        toast.success(result.message);
        onOpenChange(false);
        onSaved?.(editing ? initial.bookingId! : (result.data as { id: string }).id);
      }),
    )();

  const errors = form.formState.errors;
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? "予約を編集" : "新しい予約"}</DialogTitle>
            <DialogDescription>サービスを選ぶと、所要時間と料金が自動で入ります。</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); submit(false); }} className="grid gap-4" noValidate>
            <Field label="顧客" htmlFor="customer" required error={errors.customerId?.message}>
              <CustomerPicker
                value={customer}
                invalid={!!errors.customerId}
                canCreate={canCreateCustomer}
                onChange={(c) => {
                  setCustomer(c);
                  form.setValue("customerId", c?.id ?? "", { shouldDirty: true, shouldValidate: !!c });
                }}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="サービス" htmlFor="serviceId" required error={errors.serviceId?.message}>
                <NativeSelect id="serviceId" value={serviceId} aria-invalid={!!errors.serviceId} onChange={(e) => onServiceChange(e.target.value)}>
                  <option value="">選んでください</option>
                  {options.services.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}（{s.durationMinutes}分・{formatYen(s.price)}）</option>
                  ))}
                </NativeSelect>
              </Field>
              {options.staffSelection !== "none" && (
                <Field label="担当スタッフ" htmlFor="staffId" required={options.staffSelection === "required"} error={errors.staffId?.message}>
                  <Controller
                    control={form.control}
                    name="staffId"
                    render={({ field }) => (
                      <NativeSelect id="staffId" value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)}>
                        <option value="">{options.staffSelection === "required" ? "選んでください" : "指名なし"}</option>
                        {staffChoices.map((s) => <option key={s.id} value={s.id}>{s.name}{s.title ? `（${s.title}）` : ""}</option>)}
                      </NativeSelect>
                    )}
                  />
                </Field>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="日付" htmlFor="date" required error={errors.date?.message} className="col-span-2 sm:col-span-1">
                <Input id="date" type="date" aria-invalid={!!errors.date} {...form.register("date")} />
              </Field>
              <Field label="開始" htmlFor="startTime" required error={errors.startTime?.message}>
                <Input id="startTime" type="time" step={300} value={startTime} aria-invalid={!!errors.startTime} onChange={(e) => onStartChange(e.target.value)} />
              </Field>
              <Field label="終了" htmlFor="endTime" required error={errors.endTime?.message}>
                <Input id="endTime" type="time" step={300} aria-invalid={!!errors.endTime} {...form.register("endTime")} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="料金（円）" htmlFor="price" required error={errors.price?.message}>
                <Input id="price" type="number" min={0} inputMode="numeric" aria-invalid={!!errors.price}
                  {...form.register("price", { setValueAs: (v: string) => (v === "" ? Number.NaN : Number(v)) })} />
              </Field>
              {!editing && (
                <Field label="ステータス" htmlFor="status">
                  <NativeSelect id="status" {...form.register("status")}>
                    {(["confirmed", "checked_in", "completed"] as const).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </NativeSelect>
                </Field>
              )}
            </div>
            <Field label="備考" htmlFor="notes" error={errors.notes?.message} hint="店舗内のメモ（お客様には表示されません）">
              <Textarea id="notes" rows={2} {...form.register("notes")} />
            </Field>
            {service?.needsResource && <p className="text-xs text-muted-foreground">このサービスは設備を使います。空いている設備を自動で割り当てます。</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>閉じる</Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" aria-hidden />}
                {editing ? "変更を保存" : "予約を登録"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!warnings} onOpenChange={(o) => !o && setWarnings(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><TriangleAlert className="size-5 text-warning" aria-hidden />確認してください</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="grid gap-2">
                <ul className="list-disc pl-5 text-sm text-foreground">{warnings?.map((w) => <li key={w}>{w}</li>)}</ul>
                <p>このまま登録してもよろしいですか？</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>戻って修正する</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); submit(true); }} disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}このまま登録する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
