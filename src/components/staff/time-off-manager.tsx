"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { Field } from "@/components/common/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { addTimeOff, deleteTimeOff } from "@/lib/actions/staff";
import { formatInZone } from "@/lib/format";
import { zonedDateTime } from "@/lib/time";
import { timeOffSchema, type TimeOffInput } from "@/lib/validation/staff";

type TimeOff = { id: string; date: string; kind: "day_off" | "custom_hours"; start: string | null; end: string | null; reason: string | null; bookings: number };

/** 特定の日の休暇・勤務時間の変更（今日以降）。予約が入っている日はその件数を表示する */
export function TimeOffManager({ staffId, items, timezone, today }: { staffId: string; items: TimeOff[]; timezone: string; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [removing, setRemoving] = useState<string | null>(null);
  const form = useForm<TimeOffInput, unknown, z.output<typeof timeOffSchema>>({
    resolver: zodResolver(timeOffSchema),
    defaultValues: { date: today, kind: "day_off", start: "", end: "", reason: "" },
  });
  const kind = useWatch({ control: form.control, name: "kind" });
  const errors = form.formState.errors;
  const onSubmit = form.handleSubmit(() =>
    startTransition(async () => {
      const result = await addTimeOff(staffId, form.getValues());
      if (!result.ok) return void toast.error(result.error);
      if (result.data.affected > 0) toast.warning(`この日には予約が${result.data.affected}件あります。必要に応じて担当や日時を変更してください。`);
      else toast.success(result.message);
      form.reset({ date: today, kind: "day_off", start: "", end: "", reason: "" });
      router.refresh();
    }),
  );
  const remove = (id: string) => {
    setRemoving(id);
    startTransition(async () => {
      const result = await deleteTimeOff(id, staffId);
      setRemoving(null);
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.message);
      router.refresh();
    });
  };
  return (
    <div className="grid gap-4">
      <form onSubmit={onSubmit} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-[10rem_10rem_auto_1fr_auto] lg:items-end" noValidate>
        <Field label="日付" htmlFor="to-date" required error={errors.date?.message}>
          <Input id="to-date" type="date" min={today} {...form.register("date")} />
        </Field>
        <Field label="種類" htmlFor="to-kind">
          <NativeSelect id="to-kind" {...form.register("kind")}>
            <option value="day_off">休暇（終日休み）</option>
            <option value="custom_hours">この日だけ勤務時間を変える</option>
          </NativeSelect>
        </Field>
        {kind === "custom_hours" ? (
          <Field label="勤務時間" htmlFor="to-start" error={errors.start?.message ?? errors.end?.message}>
            <div className="flex items-center gap-2">
              <Input id="to-start" type="time" step={900} className="w-28" {...form.register("start")} />
              <span aria-hidden>〜</span>
              <Input type="time" step={900} className="w-28" aria-label="勤務終了" {...form.register("end")} />
            </div>
          </Field>
        ) : <div className="hidden lg:block" />}
        <Field label="理由（任意）" htmlFor="to-reason" error={errors.reason?.message}>
          <Input id="to-reason" {...form.register("reason")} placeholder="研修・私用など" />
        </Field>
        <Button type="submit" disabled={pending}>{pending && !removing ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}登録</Button>
      </form>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">今後の休暇・勤務変更はありません。</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {items.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="w-36 font-medium tabular">{formatInZone(zonedDateTime(t.date, "12:00", timezone), timezone, "yyyy/MM/dd(E)")}</span>
              <span>{t.kind === "day_off" ? "休暇" : `勤務 ${t.start}〜${t.end}`}</span>
              {t.reason && <span className="text-muted-foreground">（{t.reason}）</span>}
              {t.bookings > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-warning-strong"><TriangleAlert className="size-3.5" aria-hidden />この日の予約 {t.bookings}件</span>
              )}
              <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={`${t.date}の登録を削除`} disabled={pending} onClick={() => remove(t.id)}>
                {removing === t.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
