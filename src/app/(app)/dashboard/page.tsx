import type { Metadata } from "next";
import { CalendarClock, CalendarX2, Coins, UserCheck } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/auth";
import { can } from "@/lib/auth/roles";
import { getTodayBookings } from "@/lib/data/today";
import { asUser } from "@/lib/db";
import { blocksSlot } from "@/lib/domain/booking";
import { formatInZone, formatYen } from "@/lib/format";
import { DeniedNotice } from "./denied-notice";

export const metadata: Metadata = { title: "ダッシュボード" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const ctx = await requireContext();
  const { denied } = await searchParams;
  const tz = ctx.location.timezone;
  const bookings = await asUser(ctx.userId, (tx) => getTodayBookings(tx, ctx.location.id, tz));
  const active = bookings.filter((b) => blocksSlot(b.status));
  const showSales = can(ctx.role, "sales.view");
  const ownOnly = !can(ctx.role, "bookings.viewAll");

  const tiles = [
    { label: ownOnly ? "本日の担当予約" : "本日の予約", value: `${active.length}件`, icon: CalendarClock },
    { label: "来店済み・完了", value: `${bookings.filter((b) => b.status === "checked_in" || b.status === "completed").length}件`, icon: UserCheck },
    { label: "本日のキャンセル", value: `${bookings.filter((b) => !blocksSlot(b.status)).length}件`, icon: CalendarX2 },
    ...(showSales ? [{ label: "本日の売上見込み", value: formatYen(active.reduce((s, b) => s + b.price, 0)), icon: Coins }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="ダッシュボード"
        description={`${ctx.location.name} の本日の状況です。${ownOnly ? "スタッフの立場では、ご自身が担当する予約だけが表示されます。" : ""}`}
      />
      {denied && <DeniedNotice />}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label} className="gap-2 py-5">
            <CardContent className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">{t.label}</p>
                <p className="mt-1 text-2xl font-bold tabular">{t.value}</p>
              </div>
              <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-brand"><t.icon className="size-5" aria-hidden /></span>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>本日の予約</CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {bookings.length === 0 ? (
            <EmptyState icon={CalendarClock} title="本日の予約はありません" description={ownOnly ? "担当する予約が入るとここに表示されます。" : "予約が入るとここに表示されます。"} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">時刻</TableHead>
                  <TableHead>顧客</TableHead>
                  <TableHead>サービス</TableHead>
                  <TableHead className="hidden md:table-cell">担当</TableHead>
                  <TableHead>ステータス</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="tabular font-medium">{formatInZone(b.startsAt, tz, "HH:mm")}〜{formatInZone(b.endsAt, tz, "HH:mm")}</TableCell>
                    <TableCell>{b.customerName}</TableCell>
                    <TableCell>
                      <div>{b.serviceName}</div>
                      <div className="text-xs text-muted-foreground md:hidden">{b.staffName ?? b.resourceName ?? "担当なし"}</div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{b.staffName ?? b.resourceName ?? "担当なし"}</TableCell>
                    <TableCell><StatusBadge status={b.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
