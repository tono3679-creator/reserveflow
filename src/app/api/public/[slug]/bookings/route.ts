import { after, NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { processNotifications } from "@/lib/notifications/process";
import { createPublicBooking, getPublicLocation, PublicBookingError } from "@/lib/public/booking";
import { errorResponse, limit, noStore, sameOrigin } from "@/lib/public/http";
import { publicBookingSchema } from "@/lib/validation/public-booking";

/** 予約の確定（公開）。確定の直前にサーバーで空き状況を判定し直し、最後は DB の排他制約が守る */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const forbidden = sameOrigin(req);
  if (forbidden) return forbidden;
  const limited = await limit(req, "booking", serverEnv.publicBookingLimitPerHour, 3600);
  if (limited) return limited;
  try {
    const { slug } = await params;
    const input = publicBookingSchema.parse(await req.json());
    const sql = db();
    const loc = await getPublicLocation(sql, slug);
    if (!loc) throw new PublicBookingError("予約ページが見つかりません", 404);
    const result = await createPublicBooking(sql, loc, input);
    after(() => processNotifications(sql, { organizationId: loc.organizationId, limit: 10 }).catch((e) => console.error("notify", e)));
    return NextResponse.json({ bookingId: result.bookingId, manageUrl: `/book/${loc.slug}/manage/${result.token}` }, { status: 201, headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
