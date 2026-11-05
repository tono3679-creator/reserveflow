"use client";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatInZone } from "@/lib/format";
import { addDays, zonedDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export type Slot = { start: string; end: string; staffIds: string[] };
type Day = { date: string; slots: number };

const PAGE_DAYS = 14;

function query(params: Record<string, string | undefined>) {
  return new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
}

/** 日付の選択（2週間ずつ。空きのない日は選べない） */
export function DatePicker({
  slug, serviceId, staffId, timezone, today, lastDate, manage, value, onChange,
}: {
  slug: string; serviceId: string; staffId: string | "any"; timezone: string; today: string; lastDate: string; manage?: string;
  value: string | null; onChange: (date: string) => void;
}) {
  const [from, setFrom] = useState(today);
  const [days, setDays] = useState<Day[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${serviceId}|${staffId}|${from}|${manage ?? ""}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/${slug}/availability?${query({ service: serviceId, staff: staffId, from, days: String(PAGE_DAYS), manage })}`)
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error ?? "空き状況を読み込めませんでした");
        setDays(body.days);
        setError(null);
        setLoadedKey(key);
      })
      .catch((e: Error) => { if (!cancelled) { setError(e.message); setLoadedKey(key); } });
    return () => { cancelled = true; };
  }, [slug, serviceId, staffId, from, manage, key]);

  const loading = loadedKey !== key;
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" disabled={from <= today || loading} onClick={() => setFrom(addDays(from, -PAGE_DAYS) < today ? today : addDays(from, -PAGE_DAYS))}>
          <ChevronLeft aria-hidden />前の2週間
        </Button>
        <span className="text-sm text-muted-foreground tabular" aria-live="polite">
          {formatInZone(zonedDateTime(from, "12:00", timezone), timezone, "M/d")}〜{formatInZone(zonedDateTime(addDays(from, PAGE_DAYS - 1), "12:00", timezone), timezone, "M/d")}
        </span>
        <Button variant="outline" size="sm" disabled={addDays(from, PAGE_DAYS) > lastDate || loading} onClick={() => setFrom(addDays(from, PAGE_DAYS))}>
          次の2週間<ChevronRight aria-hidden />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-danger-soft p-3 text-sm text-danger-strong">{error}</p>
      ) : loading || !days ? (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" aria-hidden />空き状況を確認しています…</div>
      ) : (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {days.map((d) => {
            const at = zonedDateTime(d.date, "12:00", timezone);
            const wd = formatInZone(at, timezone, "E");
            const open = d.slots > 0;
            return (
              <li key={d.date}>
                <button
                  type="button"
                  disabled={!open}
                  aria-pressed={value === d.date}
                  aria-label={`${formatInZone(at, timezone, "M月d日(E)")} ${open ? `空き${d.slots}件` : "空きなし"}`}
                  onClick={() => onChange(d.date)}
                  className={cn(
                    "flex w-full flex-col items-center rounded-lg border px-1 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                    value === d.date ? "border-primary bg-primary text-primary-foreground" : open ? "bg-card hover:border-primary hover:bg-accent" : "cursor-not-allowed bg-muted/50 text-muted-foreground",
                  )}
                >
                  <span className={cn("text-[11px]", value !== d.date && (wd === "日" ? "text-danger-strong" : wd === "土" ? "text-info-strong" : ""))}>{wd}</span>
                  <span className="text-base font-semibold tabular">{formatInZone(at, timezone, "d")}</span>
                  <span className="text-[11px]">{open ? (d.slots >= 5 ? "◎" : "○") : "×"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">◎ 空きが多い　○ 空きあり　× 空きなし・休業日</p>
    </div>
  );
}

/** その日の空き時間の選択 */
export function TimePicker({
  slug, serviceId, staffId, date, timezone, manage, value, onChange, reloadKey = 0,
}: {
  slug: string; serviceId: string; staffId: string | "any"; date: string; timezone: string; manage?: string;
  value: string | null; onChange: (slot: Slot) => void; reloadKey?: number;
}) {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${serviceId}|${staffId}|${date}|${manage ?? ""}|${reloadKey}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/${slug}/availability?${query({ service: serviceId, staff: staffId, date, manage })}`)
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error ?? "空き時間を読み込めませんでした");
        setSlots(body.slots);
        setError(null);
        setLoadedKey(key);
      })
      .catch((e: Error) => { if (!cancelled) { setError(e.message); setLoadedKey(key); } });
    return () => { cancelled = true; };
  }, [slug, serviceId, staffId, date, manage, key]);

  if (error) return <p role="alert" className="rounded-lg border border-destructive/30 bg-danger-soft p-3 text-sm text-danger-strong">{error}</p>;
  if (loadedKey !== key || !slots) {
    return <div className="flex h-32 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" aria-hidden />空き時間を確認しています…</div>;
  }
  if (slots.length === 0) return <p className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">この日の空き時間はなくなりました。別の日を選んでください。</p>;
  const parts = [
    { label: "午前", list: slots.filter((s) => Number(formatInZone(s.start, timezone, "H")) < 12) },
    { label: "午後", list: slots.filter((s) => Number(formatInZone(s.start, timezone, "H")) >= 12) },
  ].filter((p) => p.list.length > 0);
  return (
    <div className="grid gap-4">
      {parts.map((p) => (
        <fieldset key={p.label}>
          <legend className="mb-2 text-xs font-medium text-muted-foreground">{p.label}</legend>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {p.list.map((s) => (
              <button
                key={s.start}
                type="button"
                aria-pressed={value === s.start}
                onClick={() => onChange(s)}
                className={cn(
                  "rounded-lg border px-2 py-2.5 text-sm font-medium tabular transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                  value === s.start ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary hover:bg-accent",
                )}
              >
                {formatInZone(s.start, timezone, "HH:mm")}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
