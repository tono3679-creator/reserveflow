import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CalendarDays, Mail, Phone } from "lucide-react";
import { NewBookingButton } from "@/components/bookings/new-booking-button";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { CustomerDeleteButton } from "@/components/customers/customer-delete-button";
import { CustomerFormDialog } from "@/components/customers/customer-form-dialog";
import { CustomerNotes } from "@/components/customers/customer-notes";
import { SegmentBadge } from "@/components/customers/segment-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireContext } from "@/lib/auth";
import { can } from "@/lib/auth/roles";
import { getBookingOptions } from "@/lib/data/bookings";
import { getCustomerDetail, getSegmentRules } from "@/lib/data/customers";
import { asUser } from "@/lib/db";
import { formatInZone, formatPercent, formatYen } from "@/lib/format";
import { localDate } from "@/lib/time";

export const metadata: Metadata = { title: "顧客の詳細" };

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireContext();
  const tz = ctx.location.timezone;
  const data = await asUser(ctx.userId, async (tx) => {
    const rules = await getSegmentRules(tx, ctx.location.id);
    const customer = await getCustomerDetail(tx, ctx.organizationId, ctx.location.id, id, rules, ctx.memberId);
    if (!customer) return null;
    return { customer, options: await getBookingOptions(tx, ctx.location.id) };
  });
  if (!data) notFound();
  const { customer: c, options } = data;
  const canManage = can(ctx.role, "customers.manage");
  // 無断キャンセル率 = 無断キャンセル ÷（来店 + 無断キャンセル）。キャンセルは事前連絡があるので含めない
  const noShowBase = c.visits + c.noShows;
  const stats = [
    { label: "来店回数", value: `${c.visits}回` },
    { label: "累計利用額", value: formatYen(c.spend) },
    { label: "平均単価", value: c.visits ? formatYen(Math.round(c.spend / c.visits)) : "—" },
    { label: "平均来店間隔", value: c.averageIntervalDays !== null ? `${c.averageIntervalDays}日` : "—" },
    { label: "最終来店", value: c.lastVisit ? formatInZone(c.lastVisit, tz, "yyyy/MM/dd") : "—" },
    { label: "次回予約", value: c.nextBooking ? formatInZone(c.nextBooking, tz, "M/d(E) HH:mm") : "なし" },
    { label: "無断キャンセル", value: `${c.noShows}回${noShowBase ? `（${formatPercent((c.noShows / noShowBase) * 100)}）` : ""}` },
    { label: "キャンセル", value: `${c.cancellations}回` },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${c.name} 様`}
        breadcrumbs={[{ label: "顧客管理", href: "/customers" }]}
        description={c.nameKana ?? undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canManage && <CustomerFormDialog staff={options.staff} initial={{ id: c.id, name: c.name, nameKana: c.nameKana, phone: c.phone, email: c.email, preferredStaffId: c.preferredStaffId }} />}
            {can(ctx.role, "bookings.manage") && (
              <NewBookingButton options={options} today={localDate(new Date(), tz)} canCreateCustomer={canManage}
                customer={{ id: c.id, name: c.name, nameKana: c.nameKana, phone: c.phone, email: c.email }} />
            )}
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle>来店の状況</CardTitle>
              <SegmentBadge segment={c.segment} />
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {stats.map((s) => (
                  <div key={s.label}>
                    <dt className="text-xs text-muted-foreground">{s.label}</dt>
                    <dd className="mt-0.5 text-base font-semibold tabular">{s.value}</dd>
                  </div>
                ))}
              </dl>
              {c.favoriteService && <p className="mt-4 text-sm text-muted-foreground">よく利用するサービス：<span className="text-foreground">{c.favoriteService}</span></p>}
            </CardContent>
          </Card>
          <Card className="gap-0 pb-0">
            <CardHeader className="pb-4"><CardTitle>予約の履歴</CardTitle></CardHeader>
            {c.bookings.length === 0 ? (
              <EmptyState icon={CalendarDays} title="この店舗での予約はまだありません" />
            ) : (
              <ul className="divide-y border-t">
                {c.bookings.map((b) => (
                  <li key={b.id}>
                    <Link href={`/bookings/${b.id}`} className="flex flex-col gap-1 px-6 py-3 hover:bg-accent/50 sm:flex-row sm:items-center sm:gap-4">
                      <span className="w-44 shrink-0 text-sm font-medium tabular">{formatInZone(b.startsAt, tz, "yyyy/MM/dd(E) HH:mm")}</span>
                      <span className="min-w-0 flex-1 truncate text-sm">{b.serviceName}{b.staffName ? `・${b.staffName}` : ""}</span>
                      <span className="flex items-center gap-3">
                        <span className="text-sm tabular">{formatYen(b.price)}</span>
                        <StatusBadge status={b.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader><CardTitle>連絡先</CardTitle></CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {c.phone ? <a href={`tel:${c.phone}`} className="flex items-center gap-2 hover:underline"><Phone className="size-4 text-muted-foreground" aria-hidden />{c.phone}</a> : null}
              {c.email ? <a href={`mailto:${c.email}`} className="flex items-center gap-2 break-all hover:underline"><Mail className="size-4 text-muted-foreground" aria-hidden />{c.email}</a> : null}
              {!c.phone && !c.email && <p className="text-muted-foreground">連絡先は登録されていません。</p>}
              {c.preferredStaffName && <p className="text-muted-foreground">担当スタッフ：<span className="text-foreground">{c.preferredStaffName}</span></p>}
              <p className="text-xs text-muted-foreground tabular">登録日：{formatInZone(c.createdAt, tz, "yyyy/MM/dd")}</p>
              {canManage && <div className="mt-2"><CustomerDeleteButton customerId={c.id} name={c.name} bookingCount={c.totalBookings} /></div>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>メモ</CardTitle></CardHeader>
            <CardContent>
              <CustomerNotes customerId={c.id} notes={c.notes} timezone={tz} canDeleteAny={canManage} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
