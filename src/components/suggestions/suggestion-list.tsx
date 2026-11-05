"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, CalendarPlus, Check } from "lucide-react";
import { BookingFormDialog, type BookingFormInitial } from "@/components/bookings/booking-form-dialog";
import { Button } from "@/components/ui/button";
import type { BookingOptions } from "@/lib/data/bookings";

export type SuggestionView = {
  key: string;
  date: string;
  dateLabel: string;
  start: string;
  end: string;
  staffId: string | null;
  staffName: string | null;
  resourceName: string | null;
  score: number;
  factors: { key: string; label: string; value: number; points: number; weight: number }[];
  reasons: string[];
};

/** おすすめ順の候補。「この枠で予約」で予約フォームを開く（登録時にサーバーが空きを判定し直す） */
export function SuggestionList({
  items, options, serviceId, canCreateCustomer,
}: {
  items: SuggestionView[];
  options: BookingOptions;
  serviceId: string;
  canCreateCustomer: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<BookingFormInitial | null>(null);
  const service = options.services.find((s) => s.id === serviceId);
  return (
    <>
      <ol className="grid gap-3" aria-label="おすすめ予約枠">
        {items.map((s, i) => (
          <li key={s.key} className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-semibold text-brand tabular" aria-label={`${i + 1}位`}>{i + 1}</span>
                <div className="min-w-0">
                  <p className="text-base font-semibold tabular">{s.dateLabel} {s.start}〜{s.end}</p>
                  <p className="text-sm text-muted-foreground">
                    {[s.staffName ? `担当 ${s.staffName}` : options.staffSelection === "none" ? null : "担当なし", s.resourceName ? `設備 ${s.resourceName}` : null].filter(Boolean).join("・") || "—"}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-semibold tabular leading-none">{Math.round(s.score)}<span className="ml-0.5 text-sm font-normal text-muted-foreground">点</span></p>
              </div>
            </div>

            {s.reasons.length > 0 && (
              <ul className="mt-3 grid gap-1 text-sm">
                {s.reasons.map((r) => (
                  <li key={r} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /><span>{r}</span></li>
                ))}
              </ul>
            )}

            {s.factors.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">点数の内訳</summary>
                <table className="mt-2 w-full text-left text-xs tabular sm:max-w-md">
                  <thead className="text-muted-foreground">
                    <tr><th className="py-1 font-medium">項目</th><th className="py-1 text-right font-medium">評価（0〜1）</th><th className="py-1 text-right font-medium">重み</th><th className="py-1 text-right font-medium">点</th></tr>
                  </thead>
                  <tbody>
                    {s.factors.map((f) => (
                      <tr key={f.key} className="border-t">
                        <td className="py-1">{f.label}</td>
                        <td className="py-1 text-right">{f.value.toFixed(2)}</td>
                        <td className="py-1 text-right">{f.weight}</td>
                        <td className="py-1 text-right">{f.points.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}

            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/calendar?date=${s.date}&view=staff`}><CalendarDays aria-hidden />カレンダーで見る</Link>
              </Button>
              <Button
                size="sm"
                onClick={() => setForm({ date: s.date, startTime: s.start, endTime: s.end, serviceId, staffId: s.staffId, price: service?.price, customer: null })}
              >
                <CalendarPlus aria-hidden />この枠で予約
              </Button>
            </div>
          </li>
        ))}
      </ol>
      {form && (
        <BookingFormDialog
          open
          onOpenChange={(open) => !open && setForm(null)}
          options={options}
          initial={form}
          canCreateCustomer={canCreateCustomer}
          onSaved={(id) => router.push(`/bookings/${id}`)}
        />
      )}
    </>
  );
}
