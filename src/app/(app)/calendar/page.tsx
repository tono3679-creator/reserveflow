import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/page-header";
import { CalendarView } from "@/components/calendar/calendar-view";
import { requireContext } from "@/lib/auth";
import { can } from "@/lib/auth/roles";
import { getBookingOptions } from "@/lib/data/bookings";
import { asUser } from "@/lib/db";
import { localDate } from "@/lib/time";

export const metadata: Metadata = { title: "予約カレンダー" };

/** 表示する時間帯：営業時間（臨時営業を含む）の最も早い開店〜最も遅い閉店を、前後1時間ずつ広げる */
function hourRange(rows: { opens: string; closes: string }[]): { slotMin: string; slotMax: string } {
  if (rows.length === 0) return { slotMin: "08:00:00", slotMax: "21:00:00" };
  const min = Math.max(0, Math.min(...rows.map((r) => Number(r.opens.slice(0, 2)))) - 1);
  const max = Math.min(24, Math.max(...rows.map((r) => Number(r.closes.slice(0, 2)) + (r.closes.slice(3) === "00" ? 0 : 1))) + 1);
  const pad = (h: number) => `${String(h).padStart(2, "0")}:00:00`;
  return { slotMin: pad(min), slotMax: pad(max) };
}

export default async function CalendarPage() {
  const ctx = await requireContext();
  const tz = ctx.location.timezone;
  const { options, hours } = await asUser(ctx.userId, async (tx) => {
    const [options, hours] = await Promise.all([
      getBookingOptions(tx, ctx.location.id),
      tx<{ opens: string; closes: string }[]>`
        select to_char(opens_at, 'HH24:MI') opens, to_char(closes_at, 'HH24:MI') closes from public.business_hours where location_id = ${ctx.location.id}
        union all
        select to_char(opens_at, 'HH24:MI'), to_char(closes_at, 'HH24:MI') from public.business_hour_exceptions
         where location_id = ${ctx.location.id} and not is_closed and opens_at is not null and date >= current_date`,
    ]);
    return { options, hours };
  });
  const { slotMin, slotMax } = hourRange(hours);
  const canManage = can(ctx.role, "bookings.manage");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="予約カレンダー"
        description={canManage
          ? "予約の登録・日時や担当の変更ができます。重なる予約はサーバーとデータベースが拒否します。"
          : "ご自身が担当する予約が表示されます。来店・完了の記録ができます。"}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href={`/book/${ctx.location.slug}`} target="_blank" rel="noopener"><ExternalLink aria-hidden />公開予約ページ</Link>
          </Button>
        }
      />
      <CalendarView
        timezone={tz}
        options={options}
        canManage={canManage}
        canCreateCustomer={can(ctx.role, "customers.manage")}
        slotMin={slotMin}
        slotMax={slotMax}
        today={localDate(new Date(), tz)}
      />
    </div>
  );
}
