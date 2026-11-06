import type { Metadata } from "next";
import Link from "next/link";
import { Bell, CalendarX2, Clock3, FileText, History, Info, Link2, Repeat2, UserMinus, UserPlus, Users, Wallet, Ban } from "lucide-react";
import { AnalyticsPeriodBar } from "@/components/analytics/analytics-header";
import { ChartCard } from "@/components/analytics/chart-card";
import { SimpleBarChart, SimpleLineChart, StackedBarChart } from "@/components/analytics/charts";
import { KpiCard } from "@/components/analytics/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  byGroup, byTime, daysToReturnDistribution, dormantCount, monthly, noShowCustomers, repeatSummary, returnCohorts, summary, visitCountDistribution,
  type BucketRow, type GroupRow,
} from "@/lib/analytics/metrics";
import { formatPeriod, periodRange, previousPeriod, resolvePeriod, type Period } from "@/lib/analytics/period";
import { compareAmount, compareRate, percent } from "@/lib/analytics/rates";
import { requirePermission, type AppContext } from "@/lib/auth";
import { can } from "@/lib/auth/roles";
import { getSegmentRules } from "@/lib/data/customers";
import { getLocationSettings } from "@/lib/data/settings";
import { asUser } from "@/lib/db";
import { formatInZone, formatNumber, formatYen } from "@/lib/format";
import { localDate } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "顧客分析" };

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
type Tab = "no_show" | "repeat";

/** 顧客分析（オーナー・マネージャー）：無断キャンセル分析とリピート率分析 */
export default async function CustomerAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePermission("analytics.view");
  const sp = await searchParams;
  const tab: Tab = sp.tab === "repeat" ? "repeat" : "no_show";
  const now = new Date();
  const { preset, period } = resolvePeriod(sp, localDate(now, ctx.location.timezone));
  const previous = previousPeriod(period);
  const tabHref = (t: Tab) => {
    const q = new URLSearchParams(Object.entries({ ...sp, tab: t } as Record<string, string | undefined>).filter((e): e is [string, string] => !!e[1]));
    return `/analytics/customers?${q.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="顧客分析" description="無断キャンセルとリピート（再来店）の傾向を、実際の予約データから計算します。" />
      <nav aria-label="分析の種類" className="flex gap-1 rounded-lg bg-muted p-1 sm:w-fit">
        {([["no_show", "無断キャンセル分析"], ["repeat", "リピート率分析"]] as const).map(([t, label]) => (
          <Link key={t} href={tabHref(t)} aria-current={tab === t ? "page" : undefined}
            className={cn("flex-1 rounded-md px-4 py-1.5 text-center text-sm font-medium transition-colors sm:flex-none", tab === t ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            {label}
          </Link>
        ))}
      </nav>
      <AnalyticsPeriodBar preset={preset} period={period} previous={previous} note={period.from.endsWith("-01") && period.from.slice(0, 7) === period.to.slice(0, 7) ? "前の月の同じ範囲" : undefined} />
      {tab === "no_show"
        ? <NoShowAnalysis ctx={ctx} period={period} previous={previous} now={now} />
        : <RepeatAnalysis ctx={ctx} period={period} previous={previous} now={now} />}
    </div>
  );
}

function rateRows(rows: (BucketRow | GroupRow)[], label: (r: BucketRow | GroupRow) => string) {
  return rows.map((r) => [label(r), r.noShow.target, r.noShow.noShows, percent(r.noShow.noShowRate)]);
}

async function NoShowAnalysis({ ctx, period, previous, now }: { ctx: AppContext; period: Period; previous: Period; now: Date }) {
  const tz = ctx.location.timezone;
  const range = periodRange(period, tz);
  const showMoney = can(ctx.role, "sales.view");
  const d = await asUser(ctx.userId, async (tx) => {
    const [cur, prev, months, weekdays, hours, services, customers, settings] = await Promise.all([
      summary(tx, ctx.location.id, range, now),
      summary(tx, ctx.location.id, periodRange(previous, tz), now),
      monthly(tx, ctx.location.id, tz, 12, now),
      byTime(tx, ctx.location.id, tz, range, "weekday", now),
      byTime(tx, ctx.location.id, tz, range, "hour", now),
      byGroup(tx, ctx.location.id, range, "service", now),
      noShowCustomers(tx, ctx.location.id, range, now),
      getLocationSettings(tx, ctx.location.id),
    ]);
    return { cur: cur.noShow, prev: prev.noShow, months, weekdays, hours, services, customers, settings };
  });
  const cmp = "前の期間比";
  const weekdayRows = [1, 2, 3, 4, 5, 6, 0].map((w) => d.weekdays.find((x) => x.key === w)).filter((x): x is BucketRow => !!x);
  const hourRows = d.hours.filter((h) => h.noShow.target > 0);
  const rules = d.settings?.rules;

  return (
    <>
      <div className="flex items-start gap-2 rounded-xl border bg-info-soft/50 p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-info-strong" aria-hidden />
        <div className="grid gap-1">
          <p><strong>無断キャンセル率 ＝ 無断キャンセル件数 ÷ 対象予約件数 × 100</strong></p>
          <p className="text-muted-foreground">
            対象予約件数（母数）は、開始予定時刻が対象期間にあり、いまより前に始まる予約です。将来の予約と店舗都合のキャンセルは母数から除いています。
            顧客キャンセル率も同じ母数で計算しています。
          </p>
        </div>
      </div>

      <section aria-label="主な指標" className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <KpiCard label="対象予約件数（母数）" value={`${formatNumber(d.cur.target)}件`} comparison={compareAmount(d.cur.target, d.prev.target)} compareLabel={cmp} better="none" icon={Users} />
        <KpiCard label="無断キャンセル件数" value={`${formatNumber(d.cur.noShows)}件`} comparison={compareAmount(d.cur.noShows, d.prev.noShows)} compareLabel={cmp} better="down" icon={CalendarX2} />
        <KpiCard label="無断キャンセル率" value={percent(d.cur.noShowRate)} comparison={compareRate(d.cur.noShowRate, d.prev.noShowRate)} compareLabel={cmp} better="down" icon={Ban} />
        <KpiCard label="顧客キャンセル率" value={percent(d.cur.customerCancelRate)} comparison={compareRate(d.cur.customerCancelRate, d.prev.customerCancelRate)} compareLabel={cmp} better="down"
          hint={`顧客キャンセル ${d.cur.customerCancels}件`} icon={UserMinus} />
        {showMoney ? (
          <KpiCard label="推定機会損失額" value={formatYen(d.cur.lostAmount)} comparison={compareAmount(d.cur.lostAmount, d.prev.lostAmount)} compareLabel={cmp} better="down"
            hint="無断キャンセルの予定料金の合計。実際の逸失利益とは異なります。" icon={Wallet} />
        ) : (
          <Card className="p-4 text-sm text-muted-foreground"><p className="font-medium text-foreground">推定機会損失額</p><p className="mt-1 text-xs">金額はオーナーだけが確認できます。</p></Card>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="月別の無断キャンセル率（直近12か月）" description="各月に開始予定の予約を母数にした率。母数のない月は表示しません。"
          table={{ columns: ["月", "母数", "無断キャンセル", "率"], rows: d.months.map((m) => [m.month, m.target, m.noShows, percent(m.noShowRate)]) }}>
          <SimpleLineChart data={d.months.map((m) => ({ label: `${Number(m.month.slice(5, 7))}月`, value: m.noShowRate }))} format="percent" name="無断キャンセル率" ariaLabel="月別の無断キャンセル率の折れ線グラフ" />
        </ChartCard>
        <ChartCard title="曜日別の発生率" table={{ columns: ["曜日", "母数", "無断キャンセル", "率"], rows: rateRows(weekdayRows, (r) => WEEKDAYS[(r as BucketRow).key]) }}>
          <SimpleBarChart data={weekdayRows.map((r) => ({ label: WEEKDAYS[r.key], value: r.noShow.noShowRate ?? 0 }))} format="percent" name="無断キャンセル率" ariaLabel="曜日別の無断キャンセル率の棒グラフ" />
        </ChartCard>
        <ChartCard title="時間帯別の発生率" description="予約の開始時刻（時）ごと" table={{ columns: ["時刻", "母数", "無断キャンセル", "率"], rows: rateRows(hourRows, (r) => `${(r as BucketRow).key}時`) }}>
          <SimpleBarChart data={hourRows.map((r) => ({ label: `${r.key}時`, value: r.noShow.noShowRate ?? 0 }))} format="percent" name="無断キャンセル率" ariaLabel="開始時刻別の無断キャンセル率の棒グラフ" />
        </ChartCard>
        <Card className="gap-0">
          <CardHeader className="flex-col gap-1"><CardTitle>サービス別の発生率</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>サービス</TableHead><TableHead className="text-right">母数</TableHead><TableHead className="text-right">無断キャンセル</TableHead><TableHead className="text-right">率</TableHead>{showMoney && <TableHead className="text-right">推定機会損失</TableHead>}</TableRow></TableHeader>
              <TableBody>
                {d.services.filter((s) => s.noShow.target > 0).map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.name}</TableCell>
                    <TableCell className="text-right tabular">{s.noShow.target}</TableCell>
                    <TableCell className="text-right tabular">{s.noShow.noShows}</TableCell>
                    <TableCell className="text-right tabular">{percent(s.noShow.noShowRate)}</TableCell>
                    {showMoney && <TableCell className="text-right tabular">{formatYen(s.noShow.lostAmount)}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="gap-0">
          <CardHeader className="flex-col gap-1">
            <CardTitle>顧客別の発生回数</CardTitle>
            <CardDescription className="text-xs">対象期間に無断キャンセルがあった顧客（多い順に10人）。自動での利用制限は行いません。</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {d.customers.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">この期間の無断キャンセルはありません</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>顧客</TableHead><TableHead className="text-right">無断キャンセル</TableHead><TableHead className="text-right">期間内の予約</TableHead><TableHead>最後の発生</TableHead></TableRow></TableHeader>
                <TableBody>
                  {d.customers.map((c) => (
                    <TableRow key={c.customerId}>
                      <TableCell><Link href={`/customers/${c.customerId}`} className="text-primary hover:underline">{c.name}</Link></TableCell>
                      <TableCell className="text-right tabular">{c.noShows}回</TableCell>
                      <TableCell className="text-right tabular">{c.target}件</TableCell>
                      <TableCell className="tabular text-xs">{formatInZone(c.lastNoShow, tz, "yyyy/MM/dd")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card className="gap-0">
          <CardHeader className="flex-col gap-1">
            <CardTitle>対策の状況</CardTitle>
            <CardDescription className="text-xs">この店舗の現在の設定です。</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3 text-sm">
              <Measure icon={Bell} title="リマインド通知" ok={!!rules && (rules.remindDayBefore || rules.remindSameDay)}
                text={rules ? `前日：${rules.remindDayBefore ? "送る" : "送らない"}／当日：${rules.remindSameDay ? "送る" : "送らない"}` : "—"}
                href={can(ctx.role, "settings.manage") ? "/settings" : undefined} linkLabel="店舗設定" />
              <Measure icon={FileText} title="キャンセルポリシーの表示" ok={!!rules?.cancellationPolicy}
                text={rules?.cancellationPolicy ? "公開予約ページの確認画面に表示し、同意を得ています" : "ポリシーの文章が未設定です"}
                href={can(ctx.role, "settings.manage") ? "/settings" : undefined} linkLabel="店舗設定" />
              <Measure icon={Link2} title="予約変更の導線" ok
                text={rules ? `予約完了時・通知のリンクから、開始の${rules.cancelDeadlineHours}時間前まで変更・キャンセルできます` : "—"} />
              <Measure icon={History} title="キャンセル履歴の確認" ok text="顧客詳細で、キャンセル・無断キャンセルの回数と履歴を確認できます" href="/customers" linkLabel="顧客管理" />
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Measure({ icon: Icon, title, text, ok, href, linkLabel }: { icon: typeof Bell; title: string; text: string; ok: boolean; href?: string; linkLabel?: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">{title}
          <span className={cn("ml-2 rounded-full px-1.5 py-0.5 text-[11px] font-medium", ok ? "bg-success-soft text-success-strong" : "bg-warning-soft text-warning-strong")}>{ok ? "設定済み" : "未設定"}</span>
        </p>
        <p className="text-xs text-muted-foreground">{text}{href && <> <Link href={href} className="text-primary hover:underline">{linkLabel}</Link></>}</p>
      </div>
    </li>
  );
}

async function RepeatAnalysis({ ctx, period, previous, now }: { ctx: AppContext; period: Period; previous: Period; now: Date }) {
  const tz = ctx.location.timezone;
  const range = periodRange(period, tz);
  const d = await asUser(ctx.userId, async (tx) => {
    const rules = await getSegmentRules(tx, ctx.location.id);
    const [cur, prev, cohorts, months, counts, returns, staff, services, dormant] = await Promise.all([
      repeatSummary(tx, ctx.location.id, range),
      repeatSummary(tx, ctx.location.id, periodRange(previous, tz)),
      returnCohorts(tx, ctx.location.id, range, now),
      monthly(tx, ctx.location.id, tz, 12, now),
      visitCountDistribution(tx, ctx.location.id, range),
      daysToReturnDistribution(tx, ctx.location.id, range),
      byGroup(tx, ctx.location.id, range, "staff", now),
      byGroup(tx, ctx.location.id, range, "service", now),
      dormantCount(tx, ctx.location.id, rules.dormantDays, now),
    ]);
    return { cur, prev, cohorts, months, counts, returns, staff, services, dormant, dormantDays: rules.dormantDays };
  });
  const cmp = "前の期間比";
  const monthsWithData = d.months.filter((m) => m.visitors > 0);
  const groupTable = (rows: GroupRow[], label: string, note: string) => (
    <Card className="gap-0">
      <CardHeader className="flex-col gap-1"><CardTitle>{label}</CardTitle><CardDescription className="text-xs">{note}</CardDescription></CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>{label.replace("別のリピート率", "")}</TableHead><TableHead className="text-right">来店顧客</TableHead><TableHead className="text-right">リピーター</TableHead><TableHead className="text-right">リピート率</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.filter((r) => r.visitors > 0).map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.name}</TableCell>
                <TableCell className="text-right tabular">{r.visitors}人</TableCell>
                <TableCell className="text-right tabular">{r.repeaters}人</TableCell>
                <TableCell className="text-right tabular">{percent(r.repeatRate)}</TableCell>
              </TableRow>
            ))}
            {rows.every((r) => r.visitors === 0) && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">この期間の来店はありません</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  return (
    <>
      <div className="flex items-start gap-2 rounded-xl border bg-info-soft/50 p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-info-strong" aria-hidden />
        <div className="grid gap-1">
          <p><strong>リピート率 ＝ 対象期間内のリピーター数 ÷ 対象期間内の来店顧客数 × 100</strong></p>
          <p className="text-muted-foreground">
            来店顧客は対象期間に来店（来店済み・サービス完了）した顧客で、同じ顧客の複数回の来店は1人として数えます。
            リピーターはそのうち、期間の終わりまでにこの店舗で累計2回以上来店した顧客です。
          </p>
        </div>
      </div>

      <section aria-label="主な指標" className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        <KpiCard label="来店顧客数" value={`${formatNumber(d.cur.visitors)}人`} comparison={compareAmount(d.cur.visitors, d.prev.visitors)} compareLabel={cmp} icon={Users}
          hint={`うち新規 ${d.cur.newCustomers}人（この期間が初めての来店）`} />
        <KpiCard label="リピーター数" value={`${formatNumber(d.cur.repeaters)}人`} comparison={compareAmount(d.cur.repeaters, d.prev.repeaters)} compareLabel={cmp} icon={UserPlus} />
        <KpiCard label="リピート率" value={percent(d.cur.repeatRate)} comparison={compareRate(d.cur.repeatRate, d.prev.repeatRate)} compareLabel={cmp} icon={Repeat2} />
        <KpiCard label="平均来店回数" value={d.cur.avgVisits === null ? "—" : `${d.cur.avgVisits.toFixed(2)}回`}
          comparison={compareAmount(d.cur.avgVisits, d.prev.avgVisits)} compareLabel={cmp} hint={`対象期間の来店 ${d.cur.visits}件 ÷ 来店顧客数`} icon={History} />
        <KpiCard label="平均来店間隔" value={d.cur.avgIntervalDays === null ? "—" : `${d.cur.avgIntervalDays.toFixed(1)}日`}
          comparison={compareAmount(d.cur.avgIntervalDays, d.prev.avgIntervalDays)} compareLabel={cmp} better="down" hint={`前回の来店からの日数（${d.cur.intervalSamples}件の平均）`} icon={Clock3} />
        <KpiCard label="休眠顧客数（いま時点）" value={`${formatNumber(d.dormant)}人`} comparison={{ kind: "none" }} compareLabel="" better="none"
          hint={`最後の来店から${d.dormantDays}日以上たち、今後の予約がない顧客（顧客セグメントと同じ基準）`} icon={UserMinus} />
      </section>

      <Card className="gap-0">
        <CardHeader className="flex-col gap-1">
          <CardTitle>初回来店後の再来店率</CardTitle>
          <CardDescription className="text-xs">
            対象期間に初めて来店した顧客（{d.cohorts[0]?.cohort ?? 0}人）のうち、初回から N 日以内に再来店した割合。初回から N 日たっていない顧客は「観測中」として母数から除いています。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {d.cohorts.map((c) => (
            <div key={c.days} className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">{c.days}日以内</p>
              <p className="mt-1 text-2xl font-bold tabular">{percent(c.rate)}</p>
              <p className="mt-1 text-xs text-muted-foreground tabular">確定 {c.eligible}人中 {c.returned}人・観測中 {c.cohort - c.eligible}人</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="月別リピート率（直近12か月）" description="各月を対象期間としたリピート率。来店のない月は表示しません。"
          table={{ columns: ["月", "来店顧客", "リピーター", "率"], rows: d.months.map((m) => [m.month, m.visitors, m.repeaters, percent(m.repeatRate)]) }}>
          <SimpleLineChart data={d.months.map((m) => ({ label: `${Number(m.month.slice(5, 7))}月`, value: m.repeatRate }))} format="percent" name="リピート率" ariaLabel="月別リピート率の折れ線グラフ" />
        </ChartCard>
        <ChartCard title="新規・既存顧客の構成（来店顧客数）" description="その月が初めての来店なら新規、それ以外は既存"
          table={{ columns: ["月", "新規", "既存"], rows: monthsWithData.map((m) => [m.month, m.newCustomers, m.visitors - m.newCustomers]) }}>
          <StackedBarChart data={monthsWithData.map((m) => ({ label: `${Number(m.month.slice(5, 7))}月`, new: m.newCustomers, existing: m.visitors - m.newCustomers }))}
            series={[{ key: "new", name: "新規" }, { key: "existing", name: "既存" }]} format="count" ariaLabel="月別の新規・既存顧客数の積み上げ棒グラフ" />
        </ChartCard>
        <ChartCard title="来店回数の分布" description={`対象期間に来店した顧客の、期間の終わり（${formatPeriod({ from: period.to, to: period.to })}）までの累計来店回数`}
          table={{ columns: ["累計来店回数", "顧客数"], rows: d.counts.map((c) => [c.label, c.count]) }}>
          <SimpleBarChart data={d.counts.map((c) => ({ label: c.label, value: c.count }))} format="count" name="顧客数" ariaLabel="累計来店回数ごとの顧客数の棒グラフ" />
        </ChartCard>
        <ChartCard title="再来店までの日数の分布" description="対象期間に初めて来店した顧客の、2回目の来店までの日数"
          table={{ columns: ["日数", "顧客数"], rows: d.returns.map((c) => [c.label, c.count]) }}>
          <SimpleBarChart data={d.returns.map((c) => ({ label: c.label, value: c.count }))} format="count" name="顧客数" ariaLabel="再来店までの日数ごとの顧客数の棒グラフ" />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {d.staff.length > 0 && groupTable(d.staff, "スタッフ別のリピート率", "そのスタッフが期間内に担当した顧客のうち、期間の終わりまでに同じスタッフを2回以上利用した顧客の割合")}
        {groupTable(d.services, "サービス別のリピート率", "そのサービスを期間内に利用した顧客のうち、期間の終わりまでに同じサービスを2回以上利用した顧客の割合")}
      </div>
    </>
  );
}
