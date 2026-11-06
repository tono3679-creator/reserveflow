import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; href?: string };

/** 各画面の上部：パンくずリスト・見出し・主要な操作ボタン */
export function PageHeader({
  title, description, actions, breadcrumbs = [], className,
}: { title: string; description?: string; actions?: React.ReactNode; breadcrumbs?: Crumb[]; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <nav aria-label="パンくずリスト">
        <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <li><Link href="/dashboard" className="hover:text-foreground hover:underline">ホーム</Link></li>
          {[...breadcrumbs, { label: title }].map((c, i, all) => (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1">
              <ChevronRight className="size-3" aria-hidden />
              {c.href && i < all.length - 1 ? (
                <Link href={c.href} className="hover:text-foreground hover:underline">{c.label}</Link>
              ) : (
                <span aria-current={i === all.length - 1 ? "page" : undefined} className={i === all.length - 1 ? "text-foreground" : undefined}>{c.label}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-keep text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
          {description && <p className="text-keep mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
