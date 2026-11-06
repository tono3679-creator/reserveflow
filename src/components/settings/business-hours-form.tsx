"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { updateBusinessHours } from "@/lib/actions/settings";
import { businessHoursSchema, type BusinessHoursInput } from "@/lib/validation/settings";
import { SaveBar } from "./save-bar";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
// 月曜始まりで並べる
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export function BusinessHoursForm({ initial }: { initial: { weekday: number; opensAt: string; closesAt: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<BusinessHoursInput>({
    resolver: zodResolver(businessHoursSchema),
    defaultValues: {
      days: ORDER.map((weekday) => {
        const h = initial.filter((x) => x.weekday === weekday);
        return { weekday, open: h.length > 0, opensAt: h[0]?.opensAt ?? "10:00", closesAt: h[h.length - 1]?.closesAt ?? "19:00" };
      }),
    },
  });
  const days = useWatch({ control: form.control, name: "days" });
  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await updateBusinessHours(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      form.reset(values);
      router.refresh();
    }),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>営業時間・定休日</CardTitle>
        <CardDescription>営業しない曜日はオフにすると定休日になります。空き枠の計算と公開予約ページに反映されます。</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="divide-y rounded-lg border">
            {days.map((d, i) => {
              const error = form.formState.errors.days?.[i]?.closesAt?.message;
              return (
                <div key={d.weekday} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="w-8 font-semibold">{WEEKDAYS[d.weekday]}</span>
                  <Controller
                    control={form.control}
                    name={`days.${i}.open`}
                    render={({ field }) => (
                      <label className="flex items-center gap-2 text-sm">
                        <Switch checked={field.value} onCheckedChange={field.onChange} aria-label={`${WEEKDAYS[d.weekday]}曜日に営業する`} />
                        <span className="w-12">{field.value ? "営業" : "定休日"}</span>
                      </label>
                    )}
                  />
                  {d.open && (
                    <div className="flex items-center gap-2">
                      <Input type="time" step={900} className="w-32" aria-label={`${WEEKDAYS[d.weekday]}曜日の開始時刻`} {...form.register(`days.${i}.opensAt`)} />
                      <span aria-hidden>〜</span>
                      <Input type="time" step={900} className="w-32" aria-label={`${WEEKDAYS[d.weekday]}曜日の終了時刻`} aria-invalid={!!error} {...form.register(`days.${i}.closesAt`)} />
                    </div>
                  )}
                  {error && <p role="alert" className="w-full text-xs text-destructive">{error}</p>}
                </div>
              );
            })}
          </div>
          <SaveBar pending={pending} dirty={form.formState.isDirty} />
        </form>
      </CardContent>
    </Card>
  );
}
