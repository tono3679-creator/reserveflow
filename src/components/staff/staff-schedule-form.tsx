"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";
import { SaveBar } from "@/components/settings/save-bar";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { updateStaffSchedule } from "@/lib/actions/staff";
import { staffScheduleSchema, type StaffScheduleInput } from "@/lib/validation/staff";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

type Schedule = { weekday: number; start: string; end: string; breakStart: string | null; breakEnd: string | null };

/** 曜日ごとの基本勤務（休憩つき）。営業時間外の勤務を入れても、予約は営業時間内にしか入らない */
export function StaffScheduleForm({ staffId, initial }: { staffId: string; initial: Schedule[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<StaffScheduleInput, unknown, z.output<typeof staffScheduleSchema>>({
    resolver: zodResolver(staffScheduleSchema),
    defaultValues: {
      days: ORDER.map((weekday) => {
        const s = initial.find((x) => x.weekday === weekday);
        return { weekday, working: !!s, start: s?.start ?? "10:00", end: s?.end ?? "19:00", breakStart: s?.breakStart ?? "", breakEnd: s?.breakEnd ?? "" };
      }),
    },
  });
  const days = useWatch({ control: form.control, name: "days" });
  const onSubmit = form.handleSubmit(() =>
    startTransition(async () => {
      const values = form.getValues();
      const result = await updateStaffSchedule(staffId, values);
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.message);
      form.reset(values);
      router.refresh();
    }),
  );
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <div className="divide-y rounded-lg border">
        {days.map((d, i) => {
          const e = form.formState.errors.days?.[i];
          const error = e?.end?.message ?? e?.breakEnd?.message;
          const label = `${WEEKDAYS[d.weekday]}曜日`;
          return (
            <div key={d.weekday} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="w-6 font-semibold">{WEEKDAYS[d.weekday]}</span>
              <Controller control={form.control} name={`days.${i}.working`} render={({ field }) => (
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={field.value} onCheckedChange={field.onChange} aria-label={`${label}に勤務する`} />
                  <span className="w-10">{field.value ? "勤務" : "休み"}</span>
                </label>
              )} />
              {d.working && (
                <>
                  <div className="flex items-center gap-2">
                    <Input type="time" step={900} className="w-28" aria-label={`${label}の勤務開始`} {...form.register(`days.${i}.start`)} />
                    <span aria-hidden>〜</span>
                    <Input type="time" step={900} className="w-28" aria-label={`${label}の勤務終了`} aria-invalid={!!e?.end} {...form.register(`days.${i}.end`)} />
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">休憩</span>
                    <Input type="time" step={900} className="w-28" aria-label={`${label}の休憩開始`} {...form.register(`days.${i}.breakStart`)} />
                    <span aria-hidden>〜</span>
                    <Input type="time" step={900} className="w-28" aria-label={`${label}の休憩終了`} aria-invalid={!!e?.breakEnd} {...form.register(`days.${i}.breakEnd`)} />
                  </div>
                </>
              )}
              {error && <p role="alert" className="w-full text-xs text-destructive">{error}</p>}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">休憩がない日は休憩の欄を空けてください。特定の日だけ変える場合は「休暇・勤務変更」に登録します。</p>
      <SaveBar pending={pending} dirty={form.formState.isDirty} />
    </form>
  );
}
