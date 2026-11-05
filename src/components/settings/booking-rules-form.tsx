"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Field } from "@/components/common/form-field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { updateBookingRules } from "@/lib/actions/settings";
import { bookingRulesSchema, type BookingRulesInput } from "@/lib/validation/settings";
import { SaveBar } from "./save-bar";

export function BookingRulesForm({ initial }: { initial: BookingRulesInput }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<BookingRulesInput>({ resolver: zodResolver(bookingRulesSchema), defaultValues: initial });
  const errors = form.formState.errors;
  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await updateBookingRules(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      form.reset(values);
      router.refresh();
    }),
  );
  const num = { setValueAs: (v: string) => (v === "" ? Number.NaN : Number(v)) };
  const toggle = (name: "publicBookingEnabled" | "remindDayBefore" | "remindSameDay", label: string, hint: string) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <label className="flex items-start justify-between gap-4 rounded-lg border px-4 py-3">
          <span>
            <span className="block text-sm font-medium">{label}</span>
            <span className="block text-xs text-muted-foreground">{hint}</span>
          </span>
          <Switch checked={field.value} onCheckedChange={field.onChange} aria-label={label} />
        </label>
      )}
    />
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>予約受付・キャンセル</CardTitle>
        <CardDescription>お客様の予約画面と空き枠の計算に使うルールです。</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-5" noValidate>
          {toggle("publicBookingEnabled", "公開予約ページで予約を受け付ける", "オフにすると、お客様の予約画面から新しい予約ができなくなります")}
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="スタッフの指名" htmlFor="staffSelection" hint="担当者がいない業種（レンタルスペースなど）は「指名なし」">
              <NativeSelect id="staffSelection" {...form.register("staffSelection")}>
                <option value="optional">任意（指名なしも可）</option>
                <option value="required">必須（必ずスタッフを選ぶ）</option>
                <option value="none">指名なし（スタッフを割り当てない）</option>
              </NativeSelect>
            </Field>
            <Field label="予約枠の刻み" htmlFor="slotIntervalMinutes">
              <NativeSelect id="slotIntervalMinutes" {...form.register("slotIntervalMinutes", { setValueAs: Number })}>
                {[10, 15, 20, 30, 60].map((m) => <option key={m} value={m}>{m}分ごと</option>)}
              </NativeSelect>
            </Field>
            <Field label="受付の締め切り（開始の何分前まで）" htmlFor="minLeadMinutes" error={errors.minLeadMinutes?.message}>
              <Input id="minLeadMinutes" type="number" min={0} inputMode="numeric" aria-invalid={!!errors.minLeadMinutes} {...form.register("minLeadMinutes", num)} />
            </Field>
            <Field label="何日先まで予約できるか" htmlFor="maxAdvanceDays" error={errors.maxAdvanceDays?.message}>
              <Input id="maxAdvanceDays" type="number" min={1} inputMode="numeric" aria-invalid={!!errors.maxAdvanceDays} {...form.register("maxAdvanceDays", num)} />
            </Field>
            <Field label="お客様が変更・キャンセルできる期限（開始の何時間前まで）" htmlFor="cancelDeadlineHours" error={errors.cancelDeadlineHours?.message}>
              <Input id="cancelDeadlineHours" type="number" min={0} inputMode="numeric" aria-invalid={!!errors.cancelDeadlineHours} {...form.register("cancelDeadlineHours", num)} />
            </Field>
          </div>
          <Field label="キャンセルポリシー" htmlFor="cancellationPolicy" hint="予約画面と確認メールに表示します" error={errors.cancellationPolicy?.message}>
            <Textarea id="cancellationPolicy" rows={4} aria-invalid={!!errors.cancellationPolicy} {...form.register("cancellationPolicy")} />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            {toggle("remindDayBefore", "前日にリマインドを送る", "予約の前日に確認の通知を作ります")}
            {toggle("remindSameDay", "当日にリマインドを送る", "予約の当日の朝に通知を作ります")}
          </div>
          <SaveBar pending={pending} dirty={form.formState.isDirty} />
        </form>
      </CardContent>
    </Card>
  );
}
