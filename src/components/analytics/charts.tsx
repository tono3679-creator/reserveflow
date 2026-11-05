"use client";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * 分析のグラフ（Recharts）。系列は1つか2つまで。色は --viz-1 から順に使う。
 * 値の文字は本文の色にし、系列の色は棒・線だけに使う。数値は「表で見る」でも確認できる（ChartCard）。
 */
export type ValueFormat = "yen" | "count" | "percent" | "days";

const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("ja-JP");

export function formatValue(v: number | null | undefined, f: ValueFormat): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  switch (f) {
    case "yen": return yen.format(v);
    case "count": return `${num.format(v)}件`;
    case "percent": return `${(v * 100).toFixed(1)}%`;
    case "days": return `${v.toFixed(1)}日`;
  }
}

function axisTick(v: number, f: ValueFormat): string {
  if (f === "percent") return `${Math.round(v * 100)}%`;
  if (f === "yen") return v >= 10_000 ? `${num.format(Math.round(v / 1000) / 10)}万` : num.format(v);
  return num.format(v);
}

const AXIS = { stroke: "var(--viz-grid)", tick: { fill: "var(--viz-axis)", fontSize: 11 }, tickLine: false } as const;

type TooltipPayload = { name?: string; value?: number | null; color?: string; dataKey?: string | number }[];

function Tip({ active, payload, label, format, unitLabel }: { active?: boolean; payload?: TooltipPayload; label?: string | number; format: ValueFormat; unitLabel?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <p className="font-medium">{label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-1.5 tabular">
          <span className="size-2 rounded-full" style={{ backgroundColor: p.color }} aria-hidden />
          <span className="text-muted-foreground">{p.name ?? unitLabel}</span>
          <span className="ml-auto pl-3">{formatValue(p.value ?? null, format)}</span>
        </p>
      ))}
    </div>
  );
}

/** 1系列の棒グラフ */
export function SimpleBarChart({ data, format, name, ariaLabel, height = 220 }: {
  data: { label: string; value: number }[]; format: ValueFormat; name: string; ariaLabel: string; height?: number;
}) {
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
          <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={8} />
          <YAxis {...AXIS} axisLine={false} width={48} allowDecimals={format !== "count"} tickFormatter={(v: number) => axisTick(v, format)} />
          <Tooltip cursor={{ fill: "var(--viz-grid)", opacity: 0.5 }} content={<Tip format={format} />} />
          <Bar dataKey="value" name={name} fill="var(--viz-1)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 1系列の折れ線（率などの推移）。値がない月は線を切る */
export function SimpleLineChart({ data, format, name, ariaLabel, height = 220 }: {
  data: { label: string; value: number | null }[]; format: ValueFormat; name: string; ariaLabel: string; height?: number;
}) {
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
          <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={8} />
          <YAxis {...AXIS} axisLine={false} width={48} tickFormatter={(v: number) => axisTick(v, format)} domain={format === "percent" ? [0, "auto"] : undefined} />
          <Tooltip cursor={{ stroke: "var(--viz-axis)", strokeDasharray: "3 3" }} content={<Tip format={format} />} />
          <Line dataKey="value" name={name} stroke="var(--viz-1)" strokeWidth={2} dot={{ r: 4, fill: "var(--viz-1)", stroke: "var(--card)", strokeWidth: 2 }}
            activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 2系列の積み上げ棒（新規・既存など）。凡例つき */
export function StackedBarChart({ data, series, format, ariaLabel, height = 220 }: {
  data: Record<string, string | number>[]; series: [{ key: string; name: string }, { key: string; name: string }]; format: ValueFormat; ariaLabel: string; height?: number;
}) {
  const colors = ["var(--viz-1)", "var(--viz-2)"];
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
          <XAxis dataKey="label" {...AXIS} />
          <YAxis {...AXIS} axisLine={false} width={48} allowDecimals={format !== "count"} tickFormatter={(v: number) => axisTick(v, format)} />
          <Tooltip cursor={{ fill: "var(--viz-grid)", opacity: 0.5 }} content={<Tip format={format} />} />
          <Legend itemSorter="dataKey" verticalAlign="top" align="right" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "var(--foreground)", paddingBottom: 4 }} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} stackId="a" fill={colors[i]} maxBarSize={24} isAnimationActive={false}
              stroke="var(--card)" strokeWidth={1} radius={i === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
