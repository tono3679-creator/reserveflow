"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/common/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { switchLocation } from "@/lib/actions/auth";
import type { BookingOptions } from "@/lib/data/bookings";
import { SEARCH_DAYS, SUGGESTION_COUNTS } from "@/lib/validation/suggestions";

export type SuggestionFormValues = {
  service: string; date: string; from: string; to: string; time: string; staff: string; days: number; count: number;
};

/**
 * 空き枠提案の検索条件。送信すると URL のクエリになり、サーバーで計算し直す。
 * 店舗を変えると、選択中の店舗を切り替えてから（サービス・スタッフは店舗ごとに違うため）条件を選び直す。
 */
export function SuggestionForm({
  options, values, today, locations, currentLocationId,
}: {
  options: BookingOptions;
  values: SuggestionFormValues;
  today: string;
  locations: { id: string; name: string }[];
  currentLocationId: string;
}) {
  const router = useRouter();
  const [service, setService] = useState(values.service);
  const [pending, startTransition] = useTransition();
  const staffForService = options.staff.filter((s) => options.services.find((x) => x.id === service)?.staffIds.includes(s.id));

  const onLocation = (id: string) =>
    startTransition(async () => {
      const result = await switchLocation(id);
      if (!result.ok) return void toast.error(result.error);
      router.push("/suggestions");
      router.refresh();
    });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const sp = new URLSearchParams();
    for (const [k, v] of data.entries()) if (typeof v === "string" && v !== "") sp.set(k, v);
    startTransition(() => router.push(`/suggestions?${sp.toString()}`));
  };

  return (
    <form onSubmit={onSubmit} aria-label="空き枠の検索条件" className="grid gap-4 rounded-xl border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {locations.length > 1 && (
          <Field label="希望店舗" htmlFor="sg-location">
            <NativeSelect id="sg-location" value={currentLocationId} disabled={pending} onChange={(e) => onLocation(e.target.value)}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </NativeSelect>
          </Field>
        )}
        <Field label="希望サービス" htmlFor="sg-service" required>
          <NativeSelect id="sg-service" name="service" value={service} onChange={(e) => setService(e.target.value)} required>
            {options.services.map((s) => <option key={s.id} value={s.id}>{s.name}（{s.durationMinutes}分）</option>)}
          </NativeSelect>
        </Field>
        <Field label="希望日" htmlFor="sg-date" required>
          <Input id="sg-date" name="date" type="date" min={today} defaultValue={values.date} required />
        </Field>
        <Field label="探す範囲" htmlFor="sg-days">
          <NativeSelect id="sg-days" name="days" defaultValue={String(values.days)}>
            {SEARCH_DAYS.map((d) => <option key={d} value={d}>{d === 1 ? "希望日のみ" : `希望日から${d}日間`}</option>)}
          </NativeSelect>
        </Field>
        {options.staffSelection !== "none" && (
          <Field label="希望スタッフ（任意）" htmlFor="sg-staff">
            <NativeSelect id="sg-staff" name="staff" defaultValue={values.staff} key={service}>
              <option value="">指定なし</option>
              {staffForService.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </NativeSelect>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Field label="希望時間帯（から）" htmlFor="sg-from">
            <Input id="sg-from" name="from" type="time" step={600} defaultValue={values.from} />
          </Field>
          <Field label="（まで）" htmlFor="sg-to">
            <Input id="sg-to" name="to" type="time" step={600} defaultValue={values.to} />
          </Field>
        </div>
        <Field label="希望時刻（任意）" htmlFor="sg-time" hint="近い時刻ほど点数が高くなります">
          <Input id="sg-time" name="time" type="time" step={600} defaultValue={values.time} />
        </Field>
        <Field label="候補件数" htmlFor="sg-count">
          <NativeSelect id="sg-count" name="count" defaultValue={String(values.count)}>
            {SUGGESTION_COUNTS.map((n) => <option key={n} value={n}>{n}件</option>)}
          </NativeSelect>
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Search aria-hidden />}空き枠を探す
        </Button>
      </div>
    </form>
  );
}
