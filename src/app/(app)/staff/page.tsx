import type { Metadata } from "next";
import Link from "next/link";
import { UserCog } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StaffFormDialog } from "@/components/staff/staff-form-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/auth/roles";
import { listStaff, STATS_DAYS } from "@/lib/data/staff";
import { asUser } from "@/lib/db";
import { formatPercent, formatYen } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "スタッフ管理" };

export default async function StaffPage() {
  const ctx = await requirePermission("staff.schedule");
  const { staff, services } = await asUser(ctx.userId, async (tx) => {
    const [staff, services] = await Promise.all([
      listStaff(tx, ctx.location.id, ctx.location.timezone),
      tx<{ id: string; name: string; category: string | null }[]>`
        select id, name, category from public.services where location_id = ${ctx.location.id} and is_active order by sort_order, name`,
    ]);
    return { staff, services };
  });
  const canManage = can(ctx.role, "staff.manage");
  const showSales = can(ctx.role, "sales.view");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="スタッフ管理"
        description={`勤務時間・休暇の設定と、直近${STATS_DAYS}日の実績です。稼働率は「予約で埋まった時間 ÷ 勤務時間（休憩を除く）」です。`}
        actions={canManage ? <StaffFormDialog services={services} /> : undefined}
      />
      {staff.length === 0 ? (
        <Card><EmptyState icon={UserCog} title="スタッフは登録されていません" description={canManage ? "「スタッフを追加」から登録できます。" : undefined} /></Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {staff.map((s) => (
            <li key={s.id}>
              <Link href={`/staff/${s.id}`} className="block h-full rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
                <Card className={cn("h-full gap-3 py-5 transition-shadow hover:shadow-md", !s.isActive && "opacity-60")}>
                  <CardContent className="grid gap-4">
                    <div className="flex items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ backgroundColor: s.color }} aria-hidden>
                        {s.name.slice(0, 1)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{s.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{s.title ?? "—"}・担当サービス {s.serviceIds.length}件{s.isActive ? "" : "・停止中"}</p>
                      </div>
                    </div>
                    {s.stats ? (
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                        <div><dt className="text-xs text-muted-foreground">予約</dt><dd className="font-semibold tabular">{s.stats.bookings}件</dd></div>
                        <div>
                          <dt className="text-xs text-muted-foreground">稼働率</dt>
                          <dd className="font-semibold tabular">{s.stats.utilization === null ? "—" : formatPercent(s.stats.utilization * 100)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">無断キャンセル</dt>
                          <dd className="font-semibold tabular">{s.stats.noShowRate === null ? "—" : formatPercent(s.stats.noShowRate * 100)}</dd>
                        </div>
                        {showSales ? (
                          <div><dt className="text-xs text-muted-foreground">売上</dt><dd className="font-semibold tabular">{formatYen(s.stats.revenue)}</dd></div>
                        ) : (
                          <div><dt className="text-xs text-muted-foreground">今後7日</dt><dd className="font-semibold tabular">{s.stats.upcoming}件</dd></div>
                        )}
                      </dl>
                    ) : (
                      <p className="text-xs text-muted-foreground">停止中のスタッフは実績を集計していません。</p>
                    )}
                    {s.stats && s.stats.utilization !== null && (
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`稼働率 ${formatPercent(s.stats.utilization * 100)}`}>
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, s.stats.utilization * 100)}%`, backgroundColor: s.color }} />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
