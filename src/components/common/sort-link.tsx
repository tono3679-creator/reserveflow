import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

/** 並び替えできる列見出し */
export function SortLink({
  label, active, dir, href,
}: { label: string; active: boolean; dir: "asc" | "desc"; href: string }) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <Link href={href} className="inline-flex items-center gap-1 hover:text-foreground" aria-label={`${label}で並び替え`}>
      {label}
      <Icon className={active ? "size-3.5 text-foreground" : "size-3.5 opacity-40"} aria-hidden />
    </Link>
  );
}
