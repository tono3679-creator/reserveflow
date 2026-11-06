import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

/** サーバー側ページネーション（URL の page を書き換えるリンク） */
export function Pagination({
  page, pageCount, total, pageSize, hrefFor,
}: { page: number; pageCount: number; total: number; pageSize: number; hrefFor: (page: number) => string }) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const pages = new Set<number>([1, pageCount, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pageCount));
  const list = [...pages].sort((a, b) => a - b);
  const item = "inline-flex size-8 items-center justify-center rounded-md text-sm tabular transition-colors";
  return (
    <nav aria-label="ページ送り" className="flex flex-col items-center justify-between gap-3 px-4 py-3 sm:flex-row sm:px-5">
      <p className="text-sm text-muted-foreground tabular">
        全{formatNumber(total)}件中 {formatNumber(from)}〜{formatNumber(to)}件
      </p>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={cn(item, "hover:bg-accent")} aria-label="前のページ"><ChevronLeft className="size-4" /></Link>
        ) : (
          <span className={cn(item, "opacity-40")} aria-hidden><ChevronLeft className="size-4" /></span>
        )}
        {list.map((p, i) => (
          <span key={p} className="flex items-center">
            {i > 0 && p - list[i - 1] > 1 && <span className="px-1 text-muted-foreground">…</span>}
            <Link
              href={hrefFor(p)}
              aria-current={p === page ? "page" : undefined}
              className={cn(item, p === page ? "bg-primary font-semibold text-primary-foreground" : "hover:bg-accent")}
            >
              {p}
            </Link>
          </span>
        ))}
        {page < pageCount ? (
          <Link href={hrefFor(page + 1)} className={cn(item, "hover:bg-accent")} aria-label="次のページ"><ChevronRight className="size-4" /></Link>
        ) : (
          <span className={cn(item, "opacity-40")} aria-hidden><ChevronRight className="size-4" /></span>
        )}
      </div>
    </nav>
  );
}
