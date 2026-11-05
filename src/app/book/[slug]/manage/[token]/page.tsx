import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ManageBooking } from "@/components/public/manage-booking";
import { PublicShell } from "@/components/public/public-shell";
import { db } from "@/lib/db";
import { bookableRange, findManagedBooking, getPublicLocation } from "@/lib/public/booking";
import { MANAGE_TOKEN_PATTERN } from "@/lib/public/token";

// 本人専用のリンクなので検索にも履歴の送信先にも出さない
export const metadata: Metadata = { title: "ご予約の確認", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Props = { params: Promise<{ slug: string; token: string }> };

/** 予約の確認・変更・キャンセル（予約完了時・メールで知らせるリンク） */
export default async function ManageBookingPage({ params }: Props) {
  const { slug, token } = await params;
  if (!MANAGE_TOKEN_PATTERN.test(token)) notFound();
  const sql = db();
  const loc = await getPublicLocation(sql, slug);
  if (!loc) notFound();
  const booking = await findManagedBooking(sql, loc, token);
  if (!booking) notFound();
  const range = bookableRange(loc);
  return (
    <PublicShell loc={loc}>
      <ManageBooking
        token={token}
        booking={booking}
        today={range.from}
        lastDate={range.to}
        location={{
          slug: loc.slug, timezone: loc.timezone, staffSelection: loc.staffSelection, cancellationPolicy: loc.cancellationPolicy,
          cancelDeadlineHours: loc.cancelDeadlineHours, phone: loc.phone,
          staff: loc.staff.filter((s) => loc.services.find((x) => x.id === booking.serviceId)?.staffIds.includes(s.id)),
        }}
      />
    </PublicShell>
  );
}
