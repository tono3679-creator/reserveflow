import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck2, CalendarClock, CalendarRange, CalendarX2, Coins, Gauge, Lightbulb, Receipt, Repeat2, TrendingDown, TrendingUp, UserCheck, Wallet } from "lucide-react";
import { BarList } from "@/components/analytics/bar-list";
import { ChartCard } from "@/components/analytics/chart-card";
import { SimpleBarChart, StackedBarChart } from "@/components/analytics/charts";
import { KpiCard } from "@/components/analytics/kpi-card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDashboard, type DashboardData } from "@/lib/analytics/dashboard";
import { formatPeriod } from "@/lib/analytics/period";
import { compareAmount, compareRate, percent } from "@/lib/analytics/rates";
import { requireContext, type AppContext } from "@/lib/auth";
import { can } from "@/lib/auth/roles";
import { getTodayBookings, type TodayBooking } from "@/lib/data/today";
import { asUser } from "@/lib/db";
import { BOOKING_STATUSES, blocksSlot, STATUS_LABELS } from "@/lib/domain/booking";
import { formatInZone, formatNumber, formatYen } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DeniedNotice } from "./denied-notice";

export const metadata: Metadata = { title: "ダッシュボード" };

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const STATUS_COLORS: Record<string, string> = {
  confirmed: "var(--viz-1)", checked_in: "var(--viz-6)", completed: "var(--viz-3)",
  cancelled_customer: "var(--viz-4)", cancelled_store: "var(--viz-axis)", no_show: "var(--viz-2)",
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const ctx = await requireContext();
  const { denied } = await searchParams;
  const tz = ctx.location.timezone;
  const analytics = can(ctx.role, "analytics.view");
  const [bookings, data] = await asUser(ctx.userId, (tx) => Promise.all([
    getTodayBookings(tx, ctx.location.id, tz),
    analytics ? getDashboard(tx, ctx.location.id, tz) : Promise.resolve(null),
  ]));
  const ownOnly = !can(ctx.role, "bookings.viewAll");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="ダッシュボード"
        description={`${ctx.location.name} の状況です。${ownOnly ? "スタッフの立場では、ご自身が担当する本日の予約だけが表示されます。" : "数値はすべて実際の予約データから計算しています。"}`}
      />
      {denied && <DeniedNotice />}
      {data ? <Analytics ctx={ctx} data={data} /> : <StaffTiles bookings={bookings} />}
      <TodayTable bookings={bookings} tz={tz} ownOnly={ownOnly} />
    </div>
  );
}

function StaffTiles({ bookings }: { bookings: TodayBooking[] }) {
  const tiles = [
    { label: "本日の担当予約", value: `${bookings.filter((b) => blocksSlot(b.status)).length}件`, icon: CalendarClock },
    { label: "来店済み・完了", value: `${bookings.filter((b) => b.status === "checked_in" || b.status === "completed").length}件`, icon: UserCheck },
    { label: "本日のキャンセル", value: `${bookings.filter((b) => !blocksSlot(b.status)).length}件`, icon: CalendarX2 },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {tiles.map((t) => (
        <Card key={t.label} className="flex items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm text-muted-foreground">{t.label}</p>
            <p className="mt-1 text-2xl font-bold tabular">{t.value}</p>
          </div>
          <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-brand"><t.icon className="size-5" aria-hidden /></span>
        </Card>
      ))}
    </div>
  );
}

function Analytics({ ctx, data: d }: { ctx: AppContext; data: DashboardData }) {
  const sales = can(ctx.role, "sales.view");
  const kpis = [
    { label: "本日の予約件数", value: `${formatNumber(d.todaySummary.bookings)}件`, comparison: compareAmount(d.todaySummary.bookings, d.lastWeekSameDay.bookings), compareLabel: "先週の同じ曜日比", icon: CalendarCheck2 },
    ...(sales ? [{
      label: "本日の売上", value: formatYen(d.todaySummary.sales), comparison: compareAmount(d.todaySummary.sales, d.lastWeekSameDay.sales), compareLabel: "先週の同じ曜日比",
      hint: `見込み ${formatYen(d.todaySummary.expected)}（予約確定を含む）`, icon: Wallet,
    }, {
      label: "今月の売上", value: formatYen(d.mtd.sales), comparison: compareAmount(d.mtd.sales, d.prevMtd.sales), compareLabel: "前月同期間比", icon: Coins,
    }] : []),
    { label: "今月の予約件数", value: `${formatNumber(d.mtd.bookings)}件`, comparison: compareAmount(d.mtd.bookings, d.prevMtd.bookings), compareLabel: "前月同期間比", icon: CalendarRange },
    {
      label: "リピート率（直近30日）", value: percent(d.repeat30.repeatRate), comparison: compareRate(d.repeat30.repeatRate, d.repeatPrev30.repeatRate), compareLabel: "前の30日比",
      hint: `来店 ${d.repeat30.visitors}人中 ${d.repeat30.repeaters}人`, icon: Repeat2,
    },
    {
      label: "無断キャンセル率（直近30日）", value: percent(d.last30.noShow.noShowRate), comparison: compareRate(d.last30.noShow.noShowRate, d.prev30.noShow.noShowRate), compareLabel: "前の30日比",
      better: "down" as const, hint: `母数 ${d.last30.noShow.target}件中 ${d.last30.noShow.noShows}件`, icon: CalendarX2,
    },
    ...(sales ? [{
      label: "平均客単価（直近30日）", value: d.last30.avgPrice === null ? "—" : formatYen(d.last30.avgPrice), comparison: compareAmount(d.last30.avgPrice, d.prev30.avgPrice), compareLabel: "前の30日比",
      hint: `来店 ${d.last30.visits}件`, icon: Receipt,
    }] : []),
    {
      label: "予約枠稼働率（直近30日）", value: percent(d.utilization30), comparison: compareRate(d.utilization30, d.utilizationPrev30), compareLabel: "前の30日比",
      hint: d.utilizationBasis === "resource" ? "設備の営業時間に対する予約時間" : d.utilizationBasis === "staff" ? "スタッフの勤務時間に対する予約時間" : "勤務時間・設備が未登録", icon: Gauge,
    },
  ];

  const monthLabel = (m: string) => `${Number(m.slice(5, 7))}月`;
  const months6 = d.months.slice(-6);
  const statusTotal = BOOKING_STATUSES.reduce((s, k) => s + d.last30.statusCounts[k], 0);
  const weekdayData = [1, 2, 3, 4, 5, 6, 0].map((w) => ({ label: WEEKDAYS[w], value: d.weekdays.find((x) => x.key === w)?.bookings ?? 0 }));
  const servicesTop = d.services.slice(0, 5);
  const servicesTotal = d.services.reduce((s, x) => s + x.bookings, 0);

  return (
    <>
      <section aria-label="主な指標" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {kpis.map((k) => <KpiCard key={k.label} {...k} />)}
      </section>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Lightbulb className="size-4 text-brand" aria-hidden />インサイト</CardTitle></CardHeader>
        <CardContent>
          {d.insights.length === 0 ? (
            <p className="text-sm text-muted-foreground">いまのところ、基準を満たす目立った変化・偏りはありません。</p>
          ) : (
            <ul className="grid gap-2">
              {d.insights.map((i) => {
                const Icon = i.kind === "up" ? TrendingUp : i.kind === "down" ? TrendingDown : CalendarClock;
                return (
                  <li key={i.text} className="flex items-start gap-2.5 rounded-lg border bg-muted/30 px-3 py-2">
                    <Icon className={cn("mt-0.5 size-4 shrink-0", i.kind === "up" ? "text-success-strong" : i.kind === "down" ? "text-warning-strong" : "text-info-strong")} aria-hidden />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{i.text}</p>
                      <p className="text-xs text-muted-foreground">根拠：{i.basis}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">
            予約データから決まった基準（曜日の稼働率が全体の1.15倍以上、リピート率3pt・無断キャンセル率2pt以上の変化、60分以上の空き など）で判定しています。
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {sales ? (
          <ChartCard title="月別売上推移" description="来店（来店済み・サービス完了）の料金の合計。今月は今日まで。"
            table={{ columns: ["月", "売上", "来店件数"], rows: d.months.map((m) => [m.month, formatYen(m.sales), m.visits]) }}>
            <SimpleBarChart data={d.months.map((m) => ({ label: monthLabel(m.month), value: m.sales }))} format="yen" name="売上" ariaLabel="直近12か月の月別売上の棒グラフ" />
          </ChartCard>
        ) : (
          <ChartCard title="月別予約件数" description="キャンセルを除いた予約の件数（今月は予定を含む）。"
            table={{ columns: ["月", "予約件数"], rows: d.months.map((m) => [m.month, m.bookings]) }}>
            <SimpleBarChart data={d.months.map((m) => ({ label: monthLabel(m.month), value: m.bookings }))} format="count" name="予約件数" ariaLabel="直近12か月の月別予約件数の棒グラフ" />
          </ChartCard>
        )}
        <ChartCard title="日別予約件数" description={`${formatPeriod(d.periods.last30)}。キャンセルを除く。`}
          table={{ columns: ["日付", "予約件数"], rows: d.days.map((x) => [x.date, x.bookings]) }}>
          <SimpleBarChart data={d.days.map((x) => ({ label: `${Number(x.date.slice(5, 7))}/${Number(x.date.slice(8, 10))}`, value: x.bookings }))} format="count" name="予約件数" ariaLabel="直近30日の日別予約件数の棒グラフ" />
        </ChartCard>
        <ChartCard title="予約ステータス構成" description={`${formatPeriod(d.periods.last30)}に開始予定の予約 ${statusTotal}件`}>
          <BarList items={BOOKING_STATUSES.map((s) => ({
            label: STATUS_LABELS[s], value: d.last30.statusCounts[s], color: STATUS_COLORS[s],
            display: `${d.last30.statusCounts[s]}件（${percent(statusTotal ? d.last30.statusCounts[s] / statusTotal : null, 0)}）`,
          }))} />
        </ChartCard>
        <ChartCard title="人気サービス" description={`${formatPeriod(d.periods.last90)}の予約件数（キャンセルを除く）`}>
          <BarList items={servicesTop.map((s) => ({ label: s.name, value: s.bookings, display: `${s.bookings}件（${percent(servicesTotal ? s.bookings / servicesTotal : null, 0)}）` }))} />
        </ChartCard>
        <ChartCard title="新規・リピーター（来店顧客数）" description="その月に来店した顧客のうち、初めての来店が新規、2回目以上の来店があればリピーター。"
          table={{ columns: ["月", "新規", "リピーター"], rows: months6.map((m) => [m.month, m.newCustomers, m.visitors - m.newCustomers]) }}>
          <StackedBarChart data={months6.map((m) => ({ label: monthLabel(m.month), new: m.newCustomers, repeat: m.visitors - m.newCustomers }))}
            series={[{ key: "new", name: "新規" }, { key: "repeat", name: "リピーター" }]} format="count" ariaLabel="直近6か月の新規とリピーターの来店顧客数の積み上げ棒グラフ" />
        </ChartCard>
        <ChartCard title="曜日別予約数" description={`${formatPeriod(d.periods.last90)}。キャンセルを除く。`}
          table={{ columns: ["曜日", "予約件数"], rows: weekdayData.map((w) => [w.label, w.value]) }}>
          <SimpleBarChart data={weekdayData} format="count" name="予約件数" ariaLabel="直近90日の曜日別予約件数の棒グラフ" />
        </ChartCard>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        詳しくは {sales && <><Link href="/analytics/sales" className="text-primary hover:underline">売上分析</Link>・</>}
        <Link href="/analytics/customers" className="text-primary hover:underline">顧客分析</Link> で、期間を変えて確認できます。
      </p>
    </>
  );
}

function TodayTable({ bookings, tz, ownOnly }: { bookings: TodayBooking[]; tz: string; ownOnly: boolean }) {
  return (
    <Card>
      <CardHeader><CardTitle>本日の予約</CardTitle></CardHeader>
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
                  <TableCell className="tabular font-medium">
                    <Link href={`/bookings/${b.id}`} className="hover:underline">{formatInZone(b.startsAt, tz, "HH:mm")}〜{formatInZone(b.endsAt, tz, "HH:mm")}</Link>
                  </TableCell>
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
  );
}
