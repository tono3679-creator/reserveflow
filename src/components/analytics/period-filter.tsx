"use client";
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PERIOD_PRESETS, PRESET_LABELS, type Period, type PeriodPreset } from "@/lib/analytics/period";

/** 対象期間の選択（URL の preset・from・to を書き換える。ほかのパラメータは残す） */
export function PeriodFilter({ preset, period }: { preset: PeriodPreset; period: Period }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState<PeriodPreset>(preset);
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);

  const apply = (next: PeriodPreset, f = from, t = to) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("preset", next);
    if (next === "custom") { sp.set("from", f); sp.set("to", t); } else { sp.delete("from"); sp.delete("to"); }
    router.push(`${pathname}?${sp.toString()}`);
  };

  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); apply(value); }} role="search" aria-label="対象期間の選択">
      <label className="grid gap-1 text-xs text-muted-foreground">
        対象期間
        <NativeSelect value={value} onChange={(e) => {
          const next = e.target.value as PeriodPreset;
          setValue(next);
          if (next !== "custom") apply(next);
        }} className="min-w-40">
          {PERIOD_PRESETS.map((p) => <option key={p} value={p}>{PRESET_LABELS[p]}</option>)}
        </NativeSelect>
      </label>
      {value === "custom" && (
        <>
          <label className="grid gap-1 text-xs text-muted-foreground">開始日<Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="grid gap-1 text-xs text-muted-foreground">終了日<Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
          <Button type="submit">表示</Button>
        </>
      )}
    </form>
  );
}
