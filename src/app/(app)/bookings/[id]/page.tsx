import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { History, Mail, Phone } from "lucide-react";
import { BookingDetailActions } from "@/components/bookings/booking-detail-actions";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireContext } from "@/lib/auth";
import { can } from "@/lib/auth/roles";
import { getBookingDetail, getBookingOptions } from "@/lib/data/bookings";
import { asUser } from "@/lib/db";
import { STATUS_LABELS } from "@/lib/domain/booking";
import { formatInZone, formatYen } from "@/lib/format";

export const metadata: Metadata = { title: "予約の詳細" };

const SOURCE_LABELS: Record<string, string> = { admin: "管理画面", public: "Web予約", demo: "デモデータ", system: "システム" };

export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireContext();
  const tz = ctx.location.timezone;
  const data = await asUser(ctx.userId, async (tx) => {
    const booking = await getBookingDetail(tx, id);
    // RLS で見えない予約・別の店舗の予約は「見つからない」と同じ扱いにする
    if (!booking || booking.locationId !== ctx.location.id) return null;
    return { booking, options: await getBookingOptions(tx, ctx.location.id) };
  });
  if (!data) notFound();
  const { booking: b, options } = data;
  const canManage = can(ctx.role, "bookings.manage");

  const rows: [string, React.ReactNode][] = [
    ["日時", <span key="t" className="tabular">{formatInZone(b.startsAt, tz, "yyyy年M月d日(E) HH:mm")}〜{formatInZone(b.endsAt, tz, "HH:mm")}</span>],
    ["サービス", b.serviceName],
    ...(b.staffName ? [["担当スタッフ", b.staffName] as [string, React.ReactNode]] : []),
    ...(b.resourceNames ? [["設備", b.resourceNames] as [string, React.ReactNode]] : []),
    ["料金", <span key="p" className="tabular">{formatYen(b.price)}</span>],
    ...(b.bufferBefore || b.bufferAfter ? [["準備・片付け", `前 ${b.bufferBefore}分／後 ${b.bufferAfter}分（この時間も枠を使います）`] as [string, React.ReactNode]] : []),
    ["受付経路", SOURCE_LABELS[b.source] ?? b.source],
    ["受付日時", <span key="c" className="tabular">{formatInZone(b.createdAt, tz, "yyyy/MM/dd HH:mm")}</span>],
    ...(b.customerMessage ? [["お客様からの要望", <span key="m" className="whitespace-pre-wrap">{b.customerMessage}</span>] as [string, React.ReactNode]] : []),
    ...(b.notes ? [["店舗メモ", <span key="n" className="whitespace-pre-wrap">{b.notes}</span>] as [string, React.ReactNode]] : []),
    ...(b.cancelledAt ? [["キャンセル", `${formatInZone(b.cancelledAt, tz, "yyyy/MM/dd HH:mm")}${b.cancelReason ? `（${b.cancelReason}）` : ""}`] as [string, React.ReactNode]] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="予約の詳細"
        breadcrumbs={[{ label: "予約一覧", href: "/bookings" }]}
        description={`${b.customerName} 様・${formatInZone(b.startsAt, tz, "M月d日(E) HH:mm")}`}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle>予約内容</CardTitle>
              <StatusBadge status={b.status} />
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-[9rem_1fr]">
                {rows.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="break-words">{v}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><History className="size-4" aria-hidden />ステータスの履歴</CardTitle></CardHeader>
            <CardContent>
              <ol className="grid gap-3 border-l pl-4">
                {b.history.map((h) => (
                  <li key={h.id} className="relative text-sm">
                    <span className="absolute -left-[1.3rem] top-1.5 size-2 rounded-full bg-primary" aria-hidden />
                    <p>
                      {h.from ? <>{STATUS_LABELS[h.from]} → </> : "登録："}
                      <span className="font-medium">{STATUS_LABELS[h.to]}</span>
                    </p>
                    <p className="text-xs text-muted-foreground tabular">
                      {formatInZone(h.at, tz, "yyyy/MM/dd HH:mm")}・{h.by ?? SOURCE_LABELS[h.source] ?? h.source}
                      {h.reason ? `・理由：${h.reason}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader><CardTitle>顧客</CardTitle></CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <Link href={`/customers/${b.customerId}`} className="font-medium text-primary hover:underline">{b.customerName} 様</Link>
              {b.customerPhone && <a href={`tel:${b.customerPhone}`} className="flex items-center gap-2 hover:underline"><Phone className="size-4 text-muted-foreground" aria-hidden />{b.customerPhone}</a>}
              {b.customerEmail && <a href={`mailto:${b.customerEmail}`} className="flex items-center gap-2 break-all hover:underline"><Mail className="size-4 text-muted-foreground" aria-hidden />{b.customerEmail}</a>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>操作</CardTitle></CardHeader>
            <CardContent>
              <BookingDetailActions booking={b} options={options} timezone={tz} canManage={canManage} canCreateCustomer={can(ctx.role, "customers.manage")} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
