import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { Search, Users } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { SortLink } from "@/components/common/sort-link";
import { CustomerFormDialog } from "@/components/customers/customer-form-dialog";
import { SegmentBadge } from "@/components/customers/segment-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/auth";
import { can } from "@/lib/auth/roles";
import { getSegmentRules, listCustomers } from "@/lib/data/customers";
import { asUser } from "@/lib/db";
import { SEGMENT_LABELS, SEGMENTS } from "@/lib/domain/customer-segment";
import { formatInZone, formatNumber, formatYen } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "顧客管理" };

const PAGE_SIZE = 30;
const paramsSchema = z.object({
  q: z.string().max(60).optional().catch(undefined),
  segment: z.enum(SEGMENTS).optional().catch(undefined),
  sort: z.enum(["name", "last_visit", "visits", "spend", "created_at"]).catch("last_visit"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
type Params = z.infer<typeof paramsSchema>;

function hrefWith(p: Params, change: Partial<Record<keyof Params, string | number | undefined>>) {
  const merged = { ...p, ...change };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === "" || (k === "page" && v === 1) || (k === "sort" && v === "last_visit") || (k === "dir" && v === "desc")) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `/customers?${s}` : "/customers";
}

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  const tz = ctx.location.timezone;
  const raw = await searchParams;
  const p = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v || undefined])));
  const { rules, list, staff } = await asUser(ctx.userId, async (tx) => {
    const rules = await getSegmentRules(tx, ctx.location.id);
    const [list, staff] = await Promise.all([
      listCustomers(tx, ctx.organizationId, ctx.location.id, rules, { q: p.q, segment: p.segment, sort: p.sort, dir: p.dir, page: p.page, pageSize: PAGE_SIZE }),
      tx<{ id: string; name: string }[]>`select id, name from public.staff where location_id = ${ctx.location.id} and is_active order by sort_order, name`,
    ]);
    return { rules, list, staff };
  });
  const canManage = can(ctx.role, "customers.manage");
  const pageCount = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const all = Object.values(list.segmentCounts).reduce((a, b) => a + b, 0);
  const sortHeader = (key: Params["sort"], label: string) => (
    <SortLink label={label} active={p.sort === key} dir={p.dir} href={hrefWith(p, { sort: key, dir: p.sort === key && p.dir === "desc" ? "asc" : "desc", page: 1 })} />
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="顧客管理"
        description={can(ctx.role, "customers.viewAll") ? "来店回数・最終来店日・累計利用額はこの店舗の予約から集計しています。" : "ご自身が担当した顧客だけが表示されます。"}
        actions={canManage ? <CustomerFormDialog staff={staff} /> : undefined}
      />
      <nav aria-label="セグメントで絞り込む" className="flex flex-wrap gap-2">
        {[undefined, ...SEGMENTS].map((s) => {
          const active = p.segment === s;
          return (
            <Link
              key={s ?? "all"}
              href={hrefWith(p, { segment: s, page: 1 })}
              aria-current={active ? "page" : undefined}
              className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors", active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}
            >
              {s ? SEGMENT_LABELS[s] : "すべて"}
              <span className={cn("tabular text-xs", active ? "opacity-90" : "text-muted-foreground")}>{formatNumber(s ? list.segmentCounts[s] : all)}</span>
            </Link>
          );
        })}
      </nav>
      <p className="text-xs text-muted-foreground">
        セグメントの基準：リピーター＝来店{rules.repeatMinVisits}回以上、VIP＝来店{rules.vipMinVisits}回以上かつ累計{formatYen(rules.vipMinSpend)}以上、
        休眠＝最終来店から{rules.dormantDays}日以上で今後の予約なし（基準は店舗設定で変更できます）
      </p>
      <Card className="gap-0 overflow-hidden py-0">
        <form method="get" role="search" className="flex flex-col gap-2 border-b p-4 sm:flex-row">
          {p.segment && <input type="hidden" name="segment" value={p.segment} />}
          {p.sort !== "last_visit" && <input type="hidden" name="sort" value={p.sort} />}
          {p.dir !== "desc" && <input type="hidden" name="dir" value={p.dir} />}
          <label htmlFor="customer-q" className="sr-only">キーワード</label>
          <Input id="customer-q" name="q" defaultValue={p.q} placeholder="氏名・ふりがな・電話番号・メールで検索" className="sm:max-w-sm" />
          <Button type="submit" variant="secondary"><Search aria-hidden />検索</Button>
          {p.q && <Button variant="ghost" asChild><Link href={hrefWith(p, { q: undefined, page: 1 })}>キーワードをクリア</Link></Button>}
        </form>
        {list.rows.length === 0 ? (
          <EmptyState icon={Users} title={p.q || p.segment ? "条件に合う顧客はいません" : "顧客はまだ登録されていません"} />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{sortHeader("name", "氏名")}</TableHead>
                    <TableHead>連絡先</TableHead>
                    <TableHead>セグメント</TableHead>
                    <TableHead className="text-right">{sortHeader("visits", "来店回数")}</TableHead>
                    <TableHead>{sortHeader("last_visit", "最終来店")}</TableHead>
                    <TableHead>次回予約</TableHead>
                    <TableHead className="text-right">{sortHeader("spend", "累計利用額")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.rows.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link href={`/customers/${c.id}`} className="font-medium text-primary hover:underline">{c.name}</Link>
                        {c.nameKana && <span className="block text-xs text-muted-foreground">{c.nameKana}</span>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {c.phone && <span className="block tabular">{c.phone}</span>}
                        {c.email && <span className="block break-all text-muted-foreground">{c.email}</span>}
                      </TableCell>
                      <TableCell>
                        <SegmentBadge segment={c.segment} />
                        {c.noShows > 0 && <span className="ml-1 text-xs text-danger-strong">無断{c.noShows}回</span>}
                      </TableCell>
                      <TableCell className="text-right tabular">{c.visits}回</TableCell>
                      <TableCell className="whitespace-nowrap tabular">{c.lastVisit ? formatInZone(c.lastVisit, tz, "yyyy/MM/dd") : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="whitespace-nowrap tabular">{c.nextBooking ? formatInZone(c.nextBooking, tz, "M/d(E) HH:mm") : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-right tabular">{formatYen(c.spend)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y md:hidden">
              {list.rows.map((c) => (
                <li key={c.id}>
                  <Link href={`/customers/${c.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-accent/50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{c.name}</span>
                      <SegmentBadge segment={c.segment} />
                    </div>
                    <span className="text-xs text-muted-foreground tabular">
                      来店{c.visits}回・最終 {c.lastVisit ? formatInZone(c.lastVisit, tz, "yyyy/MM/dd") : "—"}・{formatYen(c.spend)}
                    </span>
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
