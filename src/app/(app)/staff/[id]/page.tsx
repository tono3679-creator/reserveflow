import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ChartCard } from "@/components/analytics/chart-card";
import { SimpleBarChart } from "@/components/analytics/charts";
import { PageHeader } from "@/components/common/page-header";
import { StaffFormDialog } from "@/components/staff/staff-form-dialog";
import { StaffScheduleForm } from "@/components/staff/staff-schedule-form";
import { TimeOffManager } from "@/components/staff/time-off-manager";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { monthly } from "@/lib/analytics/metrics";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/auth/roles";
import { getStaffDetail, STATS_DAYS } from "@/lib/data/staff";
import { asUser } from "@/lib/db";
import { formatNumber, formatPercent, formatYen } from "@/lib/format";
import { localDate } from "@/lib/time";

export const metadata: Metadata = { title: "スタッフの詳細" };

export default async function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requirePermission("staff.schedule");
  const tz = ctx.location.timezone;
  const data = await asUser(ctx.userId, async (tx) => {
    const staff = await getStaffDetail(tx, ctx.location.id, tz, id);
    if (!staff) return null;
    const services = await tx<{ id: string; name: string; category: string | null }[]>`
      select id, name, category from public.services where location_id = ${ctx.location.id} and is_active order by sort_order, name`;
    const months = await monthly(tx, ctx.location.id, tz, 6, new Date(), { staffId: id });
    return { staff, services, months };
  });
  if (!data) notFound();
  const { staff: s, services, months } = data;
  const showSales = can(ctx.role, "sales.view");
  const st = s.stats;
  const assigned = services.filter((x) => s.serviceIds.includes(x.id));
  const stats = st ? [
    { label: "担当予約件数", value: `${st.bookings}件`, sub: `来店 ${st.visits}件` },
    ...(showSales ? [
      { label: "売上（来店分）", value: formatYen(st.revenue) },
      { label: "平均客単価", value: st.avgPrice === null ? "—" : formatYen(st.avgPrice) },
    ] : []),
    { label: "稼働率", value: st.utilization === null ? "—" : formatPercent(st.utilization * 100), sub: `${formatNumber(Math.round(st.bookedMinutes / 60))}時間 ／ 勤務 ${formatNumber(Math.round(st.workingMinutes / 60))}時間` },
    { label: "リピート率", value: st.repeatRate === null ? "—" : formatPercent(st.repeatRate * 100), sub: `${st.repeaters} ／ ${st.visitors}人` },
    { label: "無断キャンセル率", value: st.noShowRate === null ? "—" : formatPercent(st.noShowRate * 100), sub: `${st.noShows} ／ ${st.noShowTarget}件` },
    { label: "今後7日の予約", value: `${st.upcoming}件` },
  ] : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={s.name}
        breadcrumbs={[{ label: "スタッフ管理", href: "/staff" }]}
        description={[s.title, s.isActive ? null : "停止中", s.memberName ? `ログイン：${s.memberName}` : "ログインなし"].filter(Boolean).join("・")}
        actions={can(ctx.role, "staff.manage") ? <StaffFormDialog services={services} initial={{ id: s.id, name: s.name, title: s.title, email: s.email, color: s.color, isActive: s.isActive, serviceIds: s.serviceIds }} /> : undefined}
      />
      {st && (
        <Card>
          <CardHeader>
            <CardTitle>直近{STATS_DAYS}日の実績（昨日まで）</CardTitle>
            <CardDescription className="text-xs">
              稼働率 = 予約で埋まった時間 ÷ 勤務時間（休憩・休暇を除く）。リピート率 = 担当した顧客のうち、同じスタッフを累計2回以上利用した顧客の割合。
              無断キャンセル率の母数は店舗キャンセルを除く担当予約。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-7">
              {stats.map((x) => (
                <div key={x.label}>
                  <dt className="text-xs text-muted-foreground">{x.label}</dt>
                  <dd className="mt-0.5 text-lg font-semibold tabular">{x.value}</dd>
                  {x.sub && <dd className="text-xs text-muted-foreground tabular">{x.sub}</dd>}
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}
      <ChartCard title={showSales ? "月別の売上（直近6か月）" : "月別の担当予約件数（直近6か月）"}
        description={showSales ? "このスタッフが担当した予約のうち、来店分の料金" : "キャンセルを除く（今月は予定を含む）"}
        table={{ columns: showSales ? ["月", "予約件数", "来店", "売上"] : ["月", "予約件数", "来店"],
          rows: months.map((m) => showSales ? [m.month, m.bookings, m.visits, formatYen(m.sales)] : [m.month, m.bookings, m.visits]) }}>
        <SimpleBarChart data={months.map((m) => ({ label: `${Number(m.month.slice(5, 7))}月`, value: showSales ? m.sales : m.bookings }))}
          format={showSales ? "yen" : "count"} name={showSales ? "売上" : "予約件数"} ariaLabel="このスタッフの月別実績の棒グラフ" height={200} />
      </ChartCard>
      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>週の基本勤務</CardTitle>
            <CardDescription>空き枠の計算に使います。勤務時間外の予約は確認のうえで登録できます。</CardDescription>
          </CardHeader>
          <CardContent><StaffScheduleForm staffId={s.id} initial={s.schedules} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>担当できるサービス</CardTitle></CardHeader>
          <CardContent>
            {assigned.length === 0 ? (
              <p className="text-sm text-muted-foreground">担当サービスがありません。このスタッフには予約を入れられません。</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {assigned.map((x) => <li key={x.id} className="rounded-full border bg-muted/50 px-2.5 py-0.5 text-xs">{x.name}</li>)}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>休暇・勤務変更</CardTitle>
          <CardDescription>特定の日の休みや勤務時間の変更です。基本勤務より優先されます。すでに入っている予約は自動では動かしません。</CardDescription>
        </CardHeader>
        <CardContent><TimeOffManager staffId={s.id} items={s.timeOff} timezone={tz} today={localDate(new Date(), tz)} /></CardContent>
      </Card>
    </div>
  );
}
