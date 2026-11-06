import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatComparison, type Comparison } from "@/lib/analytics/rates";
import { cn } from "@/lib/utils";

/**
 * KPI カード。前の期間との比較は、良い方向（better）を決めて色と矢印で示す（色だけに頼らず文字でも示す）。
 */
export function KpiCard({
  label, value, comparison, compareLabel, better = "up", hint, icon: Icon,
}: {
  label: string; value: string; comparison: Comparison; compareLabel: string; better?: "up" | "down" | "none"; hint?: string; icon: LucideIcon;
}) {
  const v = comparison.kind === "none" ? 0 : comparison.value;
  const good = better === "none" || v === 0 ? null : (v > 0) === (better === "up");
  const Arrow = comparison.kind === "none" || v === 0 ? Minus : v > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <Card className="gap-0 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-keep text-xs text-muted-foreground sm:text-sm">{label}</p>
        <span className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-brand sm:flex"><Icon className="size-4" aria-hidden /></span>
      </div>
      <p className="mt-1 text-xl font-bold tabular sm:text-2xl">{value}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-1 text-xs">
        <span className={cn("inline-flex items-center gap-0.5 font-medium tabular",
          good === true && "text-success-strong", good === false && "text-danger-strong", good === null && "text-muted-foreground")}>
          <Arrow className="size-3.5" aria-hidden />{formatComparison(comparison)}
        </span>
        <span className="text-muted-foreground">{compareLabel}</span>
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}
