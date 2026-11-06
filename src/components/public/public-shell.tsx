import Link from "next/link";
import { Info, MapPin, Phone } from "lucide-react";
import type { PublicLocation } from "@/lib/public/booking";

/** 公開予約ページの共通の枠（店舗名・住所・電話。管理画面の要素は出さない） */
export function PublicShell({ loc, children }: { loc: Pick<PublicLocation, "name" | "address" | "phone" | "isDemo" | "slug">; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      {loc.isDemo && (
        <div className="bg-brand px-4 py-2 text-center text-xs text-white">
          <Info className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
          これはデモ用の店舗です。予約しても実際の来店予約にはならず、メールも送られません（通知は管理画面で確認できます）。
        </div>
      )}
      <header className="border-b bg-card">
        <div className="mx-auto max-w-xl px-4 py-4">
          <Link href={`/book/${loc.slug}`} className="text-xl font-bold tracking-tight">{loc.name}</Link>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {loc.address && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{loc.address}</span>}
            {loc.phone && <a href={`tel:${loc.phone}`} className="inline-flex items-center gap-1 hover:underline"><Phone className="size-3.5" aria-hidden />{loc.phone}</a>}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-6 pb-16">{children}</main>
      <footer className="pb-8 text-center text-[11px] text-muted-foreground">
        予約システム <Link href="/" className="underline-offset-2 hover:underline">ReserveFlow</Link>
      </footer>
    </div>
  );
}
