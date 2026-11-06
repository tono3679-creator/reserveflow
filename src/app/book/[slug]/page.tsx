import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BookingWizard } from "@/components/public/booking-wizard";
import { PublicShell } from "@/components/public/public-shell";
import { db } from "@/lib/db";
import { bookableRange, getPublicLocation } from "@/lib/public/booking";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const loc = await getPublicLocation(db(), (await params).slug);
  if (!loc) return { title: "ページが見つかりません", robots: { index: false } };
  // デモ店舗は検索に出さない
  return { title: `${loc.name}｜Web予約`, robots: loc.isDemo ? { index: false, follow: false } : undefined };
}

/** お客様向けの予約ページ（ログイン不要） */
export default async function PublicBookingPage({ params }: Props) {
  const loc = await getPublicLocation(db(), (await params).slug);
  if (!loc) notFound();
  const range = bookableRange(loc);
  return (
    <PublicShell loc={loc}>
      {!loc.enabled ? (
        <div className="rounded-xl border bg-card p-6 text-sm">
          <h1 className="text-lg font-bold">現在、Web予約を受け付けていません</h1>
          <p className="mt-2 text-muted-foreground">お手数ですが{loc.phone ? `お電話（${loc.phone}）で` : "店舗へ直接"}ご予約ください。</p>
        </div>
      ) : (
        <>
          <h1 className="sr-only">{loc.name} の Web予約</h1>
          <BookingWizard
            today={range.from}
            lastDate={range.to}
            location={{
              slug: loc.slug, name: loc.name, timezone: loc.timezone, staffSelection: loc.staffSelection,
              cancellationPolicy: loc.cancellationPolicy, cancelDeadlineHours: loc.cancelDeadlineHours, phone: loc.phone,
              services: loc.services, staff: loc.staff,
            }}
          />
        </>
      )}
    </PublicShell>
  );
}
