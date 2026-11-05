import { after, NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { processNotifications } from "@/lib/notifications/process";
import { cancelManagedBooking, getPublicLocation, PublicBookingError, rescheduleManagedBooking } from "@/lib/public/booking";
import { MANAGE_TOKEN_PATTERN } from "@/lib/public/token";
import { errorResponse, limit, noStore, sameOrigin } from "@/lib/public/http";
import { manageActionSchema } from "@/lib/validation/public-booking";

/** 予約の変更・キャンセル（確認リンクのトークンを知っている人だけ） */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string; token: string }> }) {
  const forbidden = sameOrigin(req);
  if (forbidden) return forbidden;
  const limited = await limit(req, "manage", serverEnv.publicBookingLimitPerHour * 2, 3600);
  if (limited) return limited;
  try {
    const { slug, token } = await params;
    if (!MANAGE_TOKEN_PATTERN.test(token)) throw new PublicBookingError("予約が見つかりません", 404);
    const action = manageActionSchema.parse(await req.json());
    const sql = db();
    const loc = await getPublicLocation(sql, slug);
    if (!loc) throw new PublicBookingError("予約が見つかりません", 404);
    if (action.action === "cancel") await cancelManagedBooking(sql, loc, token, action.reason);
    else await rescheduleManagedBooking(sql, loc, token, { startsAt: action.startsAt, staffId: action.staffId });
    after(() => processNotifications(sql, { organizationId: loc.organizationId, limit: 10 }).catch((e) => console.error("notify", e)));
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
