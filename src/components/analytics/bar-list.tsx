import Link from "next/link";

/** 横棒の一覧（ランキング・構成比）。値は文字でも表示する */
export function BarList({ items, empty = "データがありません" }: {
  items: { label: string; value: number; display: string; href?: string; color?: string }[]; empty?: string;
}) {
  const max = Math.max(0, ...items.map((i) => i.value));
  if (items.length === 0 || max === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="grid gap-2.5">
      {items.map((i) => (
        <li key={i.label} className="grid gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            {i.href ? <Link href={i.href} className="truncate hover:underline">{i.label}</Link> : <span className="truncate">{i.label}</span>}
            <span className="shrink-0 text-xs text-muted-foreground tabular">{i.display}</span>
          </div>
          <div className="h-2 rounded-full bg-muted" aria-hidden>
            <div className="h-2 rounded-full" style={{ width: `${Math.max(2, (i.value / max) * 100)}%`, backgroundColor: i.color ?? "var(--viz-1)" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
