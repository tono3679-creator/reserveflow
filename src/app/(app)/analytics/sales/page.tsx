import type { Metadata } from "next";
import { CalendarCheck2, Coins, Receipt, UserCheck } from "lucide-react";
import { AnalyticsPeriodBar } from "@/components/analytics/analytics-header";
import { BarList } from "@/components/analytics/bar-list";
import { ChartCard } from "@/components/analytics/chart-card";
import { SimpleBarChart } from "@/components/analytics/charts";
import { KpiCard } from "@/components/analytics/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { byGroup, byTime, daily, monthly, summary, utilization } from "@/lib/analytics/metrics";
import { periodDays, periodRange, previousPeriod, resolvePeriod } from "@/lib/analytics/period";
import { compareAmount, percent } from "@/lib/analytics/rates";
import { requirePermission } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { formatNumber, formatYen } from "@/lib/format";
import { localDate } from "@/lib/time";

export const metadata: Metadata = { title: "売上分析" };

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 売上分析（オーナーのみ）。売上 = 来店（来店済み・サービス完了）した予約の料金の合計 */
export default async function SalesAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePermission("sales.view");
  const tz = ctx.location.timezone;
  const now = new Date();
  const { preset, period } = resolvePeriod(await searchParams, localDate(now, tz));
  const previous = previousPeriod(period);
  const range = periodRange(period, tz);
  const data = await asUser(ctx.userId, async (tx) => {
    const [cur, prev, months, days, weekdays, hours, services, staff, util] = await Promise.all([
      summary(tx, ctx.location.id, range, now),
      summary(tx, ctx.location.id, periodRange(previous, tz), now),
      monthly(tx, ctx.location.id, tz, 12, now),
      daily(tx, ctx.location.id, tz, period),
      byTime(tx, ctx.location.id, tz, range, "weekday", now),
      byTime(tx, ctx.location.id, tz, range, "hour", now),
      byGroup(tx, ctx.location.id, range, "service", now),
      byGroup(tx, ctx.location.id, range, "staff", now),
      utilization(tx, ctx.location.id, tz, period, now),
    ]);
    return { cur, prev, months, days, weekdays, hours, services, staff, util };
  });
  const { cur, prev } = data;
  const compareLabel = "前の期間比";

  // 長い期間は日ごとだと読みにくいので月ごとにまとめる
  const long = periodDays(period) > 92;
  const timeline = long
    ? Object.entries(data.days.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.date.slice(0, 7)]: (acc[d.date.slice(0, 7)] ?? 0) + d.sales }), {}))
        .map(([m, v]) => ({ label: `${Number(m.slice(5, 7))}月`, key: m, value: v }))
    : data.days.map((d) => ({ label: `${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8, 10))}`, key: d.date, value: d.sales }));
  const weekdayData = [1, 2, 3, 4, 5, 6, 0].map((w) => ({ label: WEEKDAYS[w], value: data.weekdays.find((x) => x.key === w)?.sales ?? 0 }));
  const hourKeys = data.hours.filter((h) => h.sales > 0).map((h) => h.key);
  const hourData = hourKeys.length === 0 ? [] : Array.from({ length: Math.max(...hourKeys) - Math.min(...hourKeys) + 1 }, (_, i) => {
    const h = Math.min(...hourKeys) + i;
    return { label: `${h}時`, value: data.hours.find((x) => x.key === h)?.sales ?? 0 };
  });
  const totalSales = cur.sales;
  const utilByStaff = new Map(data.util?.byStaff.map((s) => [s.staffId, s.rate]) ?? []);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="売上分析" description="来店（来店済み・サービス完了）した予約の料金を売上として集計します。予定の料金で計算しており、実際の入金額とは異なる場合があります。" />
      <AnalyticsPeriodBar preset={preset} period={period} previous={previous} note={period.from.endsWith("-01") && period.from.slice(0, 7) === period.to.slice(0, 7) ? "前の月の同じ範囲" : undefined} />

      <section aria-label="主な指標" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard label="売上" value={formatYen(cur.sales)} comparison={compareAmount(cur.sales, prev.sales)} compareLabel={compareLabel} icon={Coins} />
        <KpiCard label="来店件数" value={`${formatNumber(cur.visits)}件`} comparison={compareAmount(cur.visits, prev.visits)} compareLabel={compareLabel} icon={UserCheck} />
        <KpiCard label="平均客単価" value={cur.avgPrice === null ? "—" : formatYen(cur.avgPrice)} comparison={compareAmount(cur.avgPrice, prev.avgPrice)} compareLabel={compareLabel} hint="売上 ÷ 来店件数" icon={Receipt} />
        <KpiCard label="予約件数" value={`${formatNumber(cur.bookings)}件`} comparison={compareAmount(cur.bookings, prev.bookings)} compareLabel={compareLabel}
          hint="キャンセルを除く（無断キャンセル・今後の予定を含む）" icon={CalendarCheck2} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={long ? "月ごとの売上（対象期間）" : "日ごとの売上（対象期間）"}
          table={{ columns: [long ? "月" : "日付", "売上"], rows: timeline.map((t) => [t.key, formatYen(t.value)]) }}>
          <SimpleBarChart data={timeline} format="yen" name="売上" ariaLabel="対象期間の売上の棒グラフ" />
        </ChartCard>
        <ChartCard title="月別売上推移（直近12か月）" description="対象期間に関係なく、今月を含む直近12か月"
          table={{ columns: ["月", "売上", "来店件数", "平均客単価"], rows: data.months.map((m) => [m.month, formatYen(m.sales), m.visits, m.visits ? formatYen(Math.round(m.sales / m.visits)) : "—"]) }}>
          <SimpleBarChart data={data.months.map((m) => ({ label: `${Number(m.month.slice(5, 7))}月`, value: m.sales }))} format="yen" name="売上" ariaLabel="直近12か月の月別売上の棒グラフ" />
        </ChartCard>
        <ChartCard title="曜日別の売上" table={{ columns: ["曜日", "売上"], rows: weekdayData.map((w) => [w.label, formatYen(w.value)]) }}>
          <SimpleBarChart data={weekdayData} format="yen" name="売上" ariaLabel="曜日別の売上の棒グラフ" />
        </ChartCard>
        <ChartCard title="開始時刻別の売上" description="予約の開始時刻（時）ごと" table={{ columns: ["時刻", "売上"], rows: hourData.map((h) => [h.label, formatYen(h.value)]) }}>
          {hourData.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">この期間の売上はありません</p>
            : <SimpleBarChart data={hourData} format="yen" name="売上" ariaLabel="開始時刻別の売上の棒グラフ" />}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <ChartCard title="サービス別の売上構成">
          <BarList items={[...data.services].filter((s) => s.sales > 0).sort((a, b) => b.sales - a.sales).map((s) => ({ label: s.name, value: s.sales, display: `${formatYen(s.sales)}（${percent(totalSales ? s.sales / totalSales : null, 0)}）` }))} empty="この期間の売上はありません" />
        </ChartCard>
        <Card className="gap-0">
          <CardHeader className="flex-col gap-1"><CardTitle>サービス別</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>サービス</TableHead><TableHead className="text-right">予約</TableHead><TableHead className="text-right">来店</TableHead>
                  <TableHead className="text-right">売上</TableHead><TableHead className="text-right">平均客単価</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.services.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.name}</TableCell>
                    <TableCell className="text-right tabular">{s.bookings}</TableCell>
                    <TableCell className="text-right tabular">{s.visits}</TableCell>
                    <TableCell className="text-right tabular">{formatYen(s.sales)}</TableCell>
                    <TableCell className="text-right tabular">{s.avgPrice === null ? "—" : formatYen(s.avgPrice)}</TableCell>
                  </TableRow>
                ))}
                {data.services.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">この期間の予約はありません</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {data.staff.length > 0 && (
        <Card className="gap-0">
          <CardHeader className="flex-col gap-1">
            <CardTitle>スタッフ別</CardTitle>
            <CardDescription className="text-xs">
              稼働率 = 予約で埋まった時間 ÷ 勤務時間（休憩・休暇を除く。今日まで）。リピート率 = 期間内にそのスタッフが担当した顧客のうち、期間の終わりまでに同じスタッフを2回以上利用した顧客の割合。
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>スタッフ</TableHead><TableHead className="text-right">担当予約</TableHead><TableHead className="text-right">来店</TableHead>
                  <TableHead className="text-right">売上</TableHead><TableHead className="text-right">平均客単価</TableHead>
                  <TableHead className="text-right">稼働率</TableHead><TableHead className="text-right">リピート率</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.staff.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.name}</TableCell>
                    <TableCell className="text-right tabular">{s.bookings}</TableCell>
                    <TableCell className="text-right tabular">{s.visits}</TableCell>
                    <TableCell className="text-right tabular">{formatYen(s.sales)}</TableCell>
                    <TableCell className="text-right tabular">{s.avgPrice === null ? "—" : formatYen(s.avgPrice)}</TableCell>
                    <TableCell className="text-right tabular">{percent(utilByStaff.get(s.id) ?? null)}</TableCell>
                    <TableCell className="text-right tabular">{percent(s.repeatRate)}<span className="ml-1 text-xs text-muted-foreground">（{s.repeaters}/{s.visitors}人）</span></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
