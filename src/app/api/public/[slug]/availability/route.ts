import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { availableDays, availableSlots, bookableRange, findManagedBooking, getPublicLocation, PublicBookingError } from "@/lib/public/booking";
import { errorResponse, limit, noStore } from "@/lib/public/http";
import { availabilityQuerySchema } from "@/lib/validation/public-booking";

/**
 * 空き状況（公開）。date を渡すとその日の空き時間、from を渡すと日付ごとの空き数。
 * manage（予約の確認リンクのトークン）を渡すと、その予約自身の枠は空きとして数える（日時の変更用）。
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const limited = await limit(req, "availability", 120, 600);
  if (limited) return limited;
  try {
    const { slug } = await params;
    const q = availabilityQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const sql = db();
    const loc = await getPublicLocation(sql, slug);
    if (!loc || !loc.enabled) throw new PublicBookingError("予約ページが見つかりません", 404);
    let excludeBookingId: string | undefined;
    if (q.manage) {
      const b = await findManagedBooking(sql, loc, q.manage);
      if (!b) throw new PublicBookingError("予約が見つかりません", 404);
      excludeBookingId = b.id;
    }
    const range = bookableRange(loc);
    if (q.date) {
      if (q.date < range.from || q.date > range.to) return NextResponse.json({ slots: [] }, { headers: noStore });
      const slots = await availableSlots(sql, loc, { serviceId: q.service, staffId: q.staff, date: q.date, excludeBookingId });
      return NextResponse.json({ slots }, { headers: noStore });
    }
    const from = q.from && q.from > range.from ? q.from : range.from;
    const days = await availableDays(sql, loc, { serviceId: q.service, staffId: q.staff, from, days: q.days, excludeBookingId });
    return NextResponse.json({ days: days.filter((d) => d.date <= range.to), range }, { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
