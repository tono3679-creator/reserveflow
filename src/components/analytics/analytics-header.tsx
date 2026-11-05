import { CalendarRange } from "lucide-react";
import { formatPeriod, type Period, type PeriodPreset } from "@/lib/analytics/period";
import { PeriodFilter } from "./period-filter";

/** 分析画面の期間の選択と、対象期間・比較期間の明示 */
export function AnalyticsPeriodBar({ preset, period, previous, note }: { preset: PeriodPreset; period: Period; previous: Period; note?: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-end sm:justify-between">
      <PeriodFilter preset={preset} period={period} />
      <div className="text-xs text-muted-foreground sm:text-right">
        <p className="flex items-center gap-1 font-medium text-foreground sm:justify-end"><CalendarRange className="size-3.5" aria-hidden />対象期間：{formatPeriod(period)}</p>
        <p>比較：{formatPeriod(previous)}（{note ?? "直前の同じ日数"}）</p>
      </div>
    </div>
  );
}
