import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { CalendarSearch, Search } from "lucide-react";
import { NewBookingButton } from "@/components/bookings/new-booking-button";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { SortLink } from "@/components/common/sort-link";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/auth";
import { can } from "@/lib/auth/roles";
import { getBookingOptions, listBookings, type BookingListFilters } from "@/lib/data/bookings";
import { asUser } from "@/lib/db";
import { BOOKING_STATUSES, STATUS_LABELS } from "@/lib/domain/booking";
import { formatInZone, formatYen } from "@/lib/format";
import { addDays, localDate, zonedDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "予約一覧" };

const SOURCE_LABELS: Record<string, string> = { admin: "管理画面", public: "Web予約", demo: "デモデータ" };
const PAGE_SIZE = 30;
const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined);
const paramsSchema = z.object({
  q: z.string().max(60).optional().catch(undefined),
  status: z.enum([...BOOKING_STATUSES, "active"]).optional().catch(undefined),
  staff: z.uuid().optional().catch(undefined),
  service: z.uuid().optional().catch(undefined),
  from: dateParam,
  to: dateParam,
  sort: z.enum(["starts_at", "price", "created_at"]).catch("starts_at"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

type Params = z.infer<typeof paramsSchema>;

function hrefWith(p: Params, change: Partial<Record<keyof Params, string | number | undefined>>) {
  const merged = { ...p, ...change };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === "" || (k === "page" && v === 1) || (k === "sort" && v === "starts_at") || (k === "dir" && v === "desc")) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `/bookings?${s}` : "/bookings";
}

export default async function BookingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  const tz = ctx.location.timezone;
  const raw = await searchParams;
  const p = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v || undefined])));
  const filters: BookingListFilters = {
    q: p.q, status: p.status, staffId: p.staff, serviceId: p.service,
    from: p.from ? zonedDateTime(p.from, "00:00", tz) : undefined,
    to: p.to ? zonedDateTime(addDays(p.to, 1), "00:00", tz) : undefined,
    sort: p.sort, dir: p.dir, page: p.page, pageSize: PAGE_SIZE,
  };
  const { options, list } = await asUser(ctx.userId, async (tx) => {
    const [options, list] = await Promise.all([getBookingOptions(tx, ctx.location.id), listBookings(tx, ctx.location.id, filters)]);
    return { options, list };
  });
  const canManage = can(ctx.role, "bookings.manage");
  const pageCount = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const sortHeader = (key: Params["sort"], label: string) => (
    <SortLink label={label} active={p.sort === key} dir={p.dir}
      href={hrefWith(p, { sort: key, dir: p.sort === key && p.dir === "desc" ? "asc" : "desc", page: 1 })} />
  );
  const filtered = !!(p.q || p.status || p.staff || p.service || p.from || p.to);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="予約一覧"
        description={can(ctx.role, "bookings.viewAll") ? "店舗のすべての予約を検索・絞り込みできます。" : "ご自身が担当する予約だけが表示されます。"}
        actions={canManage ? <NewBookingButton options={options} today={localDate(new Date(), tz)} canCreateCustomer={can(ctx.role, "customers.manage")} /> : undefined}
      />
      <Card className="p-4">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1.5fr)_repeat(3,minmax(8rem,1fr))_auto_auto_auto] lg:items-end" role="search">
          <label className="grid gap-1 text-xs text-muted-foreground">
            キーワード
            <Input name="q" defaultValue={p.q} placeholder="顧客名・ふりがな・電話・メール・サービス" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            ステータス
            <NativeSelect name="status" defaultValue={p.status ?? ""}>
              <option value="">すべて</option>
              <option value="active">有効な予約（キャンセル以外）</option>
              {BOOKING_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </NativeSelect>
          </label>
          {options.staff.length > 0 && can(ctx.role, "bookings.viewAll") && (
            <label className="grid gap-1 text-xs text-muted-foreground">
              担当
              <NativeSelect name="staff" defaultValue={p.staff ?? ""}>
                <option value="">全員</option>
                {options.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </NativeSelect>
            </label>
          )}
          <label className="grid gap-1 text-xs text-muted-foreground">
            サービス
            <NativeSelect name="service" defaultValue={p.service ?? ""}>
              <option value="">すべて</option>
              {options.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            開始日から
            <Input type="date" name="from" defaultValue={p.from} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            開始日まで
            <Input type="date" name="to" defaultValue={p.to} />
          </label>
          <div className="flex gap-2">
            {p.sort !== "starts_at" && <input type="hidden" name="sort" value={p.sort} />}
            {p.dir !== "desc" && <input type="hidden" name="dir" value={p.dir} />}
            <Button type="submit"><Search aria-hidden />検索</Button>
            {filtered && <Button variant="ghost" asChild><Link href="/bookings">条件をクリア</Link></Button>}
          </div>
        </form>
      </Card>

      <Card className="gap-0 overflow-hidden py-0">
        {list.rows.length === 0 ? (
          <EmptyState icon={CalendarSearch} title={filtered ? "条件に合う予約はありません" : "予約はまだありません"}
            description={filtered ? "条件を変えて検索してください。" : canManage ? "「新規予約」から登録できます。" : undefined} />
        ) : (
          <>
            {/* 画面が広いときは表、狭いときはカード */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{sortHeader("starts_at", "日時")}</TableHead>
                    <TableHead>顧客</TableHead>
                    <TableHead>サービス</TableHead>
                    <TableHead>担当</TableHead>
                    <TableHead>ステータス</TableHead>
                    <TableHead className="text-right">{sortHeader("price", "料金")}</TableHead>
                    <TableHead>経路</TableHead>
                    <TableHead>{sortHeader("created_at", "受付日")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap tabular">
                        <Link href={`/bookings/${r.id}`} className="font-medium text-primary hover:underline">
                          {formatInZone(r.startsAt, tz, "yyyy/MM/dd(E) HH:mm")}
                        </Link>
                        <span className="text-muted-foreground">〜{formatInZone(r.endsAt, tz, "HH:mm")}</span>
                      </TableCell>
                      <TableCell><Link href={`/customers/${r.customerId}`} className="hover:underline">{r.customerName}</Link></TableCell>
                      <TableCell>{r.serviceName}</TableCell>
                      <TableCell>{r.staffName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell><StatusBadge status={r.status} /></TableCell>
                      <TableCell className="text-right tabular">{formatYen(r.price)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{SOURCE_LABELS[r.source] ?? r.source}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular">{formatInZone(r.createdAt, tz, "yyyy/MM/dd")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y md:hidden">
              {list.rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/bookings/${r.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-accent/50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium tabular">{formatInZone(r.startsAt, tz, "M/d(E) HH:mm")}〜{formatInZone(r.endsAt, tz, "HH:mm")}</span>
                      <StatusBadge status={r.status} />
                    </div>
                    <span className="text-sm">{r.customerName}</span>
                    <span className="text-xs text-muted-foreground">{r.serviceName}{r.staffName ? `・${r.staffName}` : ""}・{formatYen(r.price)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="border-t">
              <Pagination page={Math.min(p.page, pageCount)} pageCount={pageCount} total={list.total} pageSize={PAGE_SIZE} hrefFor={(n) => hrefWith(p, { page: n })} />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
