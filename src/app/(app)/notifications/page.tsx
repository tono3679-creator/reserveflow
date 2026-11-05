import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { BellOff, Info, Search } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { NotificationBodyButton, RetryButton, RunNowButton } from "@/components/notifications/notification-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/lib/auth";
import { listNotifications, notificationCounts, type DeliveryState } from "@/lib/data/notifications";
import { asUser } from "@/lib/db";
import { formatInZone } from "@/lib/format";
import { emailConfigured } from "@/lib/notifications/adapters";
import { NOTIFICATION_LABELS, type NotificationType } from "@/lib/notifications/templates";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "通知管理" };

const PAGE_SIZE = 30;
const TYPES = Object.keys(NOTIFICATION_LABELS) as NotificationType[];
const STATES = ["sent", "demo", "unsent", "pending", "skipped", "failed"] as const satisfies readonly DeliveryState[];
const STATE_LABELS: Record<DeliveryState, string> = {
  sent: "送信済み", demo: "デモ表示", unsent: "未処理", pending: "処理中", skipped: "送信対象外", failed: "送信失敗",
};
const STATE_CLASS: Record<DeliveryState, string> = {
  sent: "bg-success-soft text-success-strong ring-success-strong/20",
  demo: "bg-info-soft text-info-strong ring-info-strong/20",
  unsent: "bg-muted text-muted-foreground ring-border",
  pending: "bg-warning-soft text-warning-strong ring-warning-strong/20",
  skipped: "bg-muted text-muted-foreground ring-border",
  failed: "bg-danger-soft text-danger-strong ring-danger-strong/20",
};

const paramsSchema = z.object({
  type: z.enum(TYPES as [NotificationType, ...NotificationType[]]).optional().catch(undefined),
  status: z.enum(STATES).optional().catch(undefined),
  q: z.string().trim().max(60).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
type Params = z.infer<typeof paramsSchema>;

function hrefWith(p: Params, change: Partial<Record<keyof Params, string | number | undefined>>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...p, ...change })) if (v !== undefined && v !== "" && !(k === "page" && v === 1)) sp.set(k, String(v));
  const s = sp.toString();
  return s ? `/notifications?${s}` : "/notifications";
}

function StateBadge({ state }: { state: DeliveryState }) {
  return <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", STATE_CLASS[state])}>{STATE_LABELS[state]}</span>;
}

/** 通知の履歴：予約の確定・変更・キャンセル・リマインドごとに、誰へ何を送ったか（送れなかったか）を表示する */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePermission("notifications.view");
  const tz = ctx.location.timezone;
  const raw = await searchParams;
  const p = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v || undefined])));
  const { list, counts, showcase } = await asUser(ctx.userId, async (tx) => {
    const [list, counts, [org]] = await Promise.all([
      listNotifications(tx, ctx.location.id, { type: p.type, status: p.status, q: p.q, page: p.page, pageSize: PAGE_SIZE }),
      notificationCounts(tx, ctx.location.id),
      tx<{ is_showcase: boolean }[]>`select is_showcase from public.organizations where id = ${ctx.organizationId}`,
    ]);
    return { list, counts, showcase: !!org?.is_showcase };
  });
  const demoOnly = ctx.isDemo || showcase || !emailConfigured();
  const pageCount = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const filtered = !!(p.type || p.status || p.q);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="通知管理" description="予約の確定・変更・キャンセルとリマインドの通知の履歴と、送信の状態です。" actions={<RunNowButton />} />

      <div className="flex items-start gap-2 rounded-xl border bg-info-soft/50 p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-info-strong" aria-hidden />
        <div className="grid gap-1">
          {demoOnly ? (
            <p>
              {ctx.isDemo || showcase ? "デモ環境のため" : "メール送信の設定（RESEND_API_KEY・NOTIFY_FROM_EMAIL）がないため"}、
              メールは実際には送らず、送る予定だった内容を「デモ表示」としてここに記録しています。「本文」で中身を確認できます。
            </p>
          ) : (
            <p>メールは Resend で送信します。失敗した通知は自動で3回まで再試行し、その後は「再送」で送り直せます。</p>
          )}
          <p className="text-xs text-muted-foreground">リマインドは毎日の自動処理で作成されます（前日・当日の設定は「店舗設定」）。「今すぐ処理する」で手動でも実行できます。</p>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {STATES.map((s) => (
          <Link key={s} href={hrefWith(p, { status: p.status === s ? undefined : s, page: 1 })}
            className={cn("rounded-lg border bg-card px-3 py-2 transition-colors hover:border-primary", p.status === s && "border-primary ring-1 ring-primary")}>
            <dt className="text-xs text-muted-foreground">{STATE_LABELS[s]}</dt>
            <dd className="text-lg font-semibold tabular">{counts[s]}</dd>
          </Link>
        ))}
      </dl>
      <p className="-mt-2 text-xs text-muted-foreground">件数は直近30日の通知です。</p>

      <Card className="p-4">
        <form method="get" role="search" className="grid gap-3 sm:grid-cols-[minmax(12rem,1.5fr)_repeat(2,minmax(8rem,1fr))_auto] sm:items-end">
          <label className="grid gap-1 text-xs text-muted-foreground">
            キーワード
            <Input name="q" defaultValue={p.q} placeholder="顧客名・宛先" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            種類
            <NativeSelect name="type" defaultValue={p.type ?? ""}>
              <option value="">すべて</option>
              {TYPES.map((t) => <option key={t} value={t}>{NOTIFICATION_LABELS[t]}</option>)}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            状態
            <NativeSelect name="status" defaultValue={p.status ?? ""}>
              <option value="">すべて</option>
              {STATES.map((s) => <option key={s} value={s}>{STATE_LABELS[s]}</option>)}
            </NativeSelect>
          </label>
          <div className="flex gap-2">
            <Button type="submit"><Search aria-hidden />検索</Button>
            {filtered && <Button variant="ghost" asChild><Link href="/notifications">条件をクリア</Link></Button>}
          </div>
        </form>
      </Card>

      <Card className="gap-0 overflow-hidden py-0">
        {list.rows.length === 0 ? (
          <EmptyState icon={BellOff} title={filtered ? "条件に合う通知はありません" : "通知はまだありません"}
            description={filtered ? undefined : "予約が登録・変更・キャンセルされると、ここに通知が記録されます。"} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>作成日時</TableHead>
                    <TableHead>種類</TableHead>
                    <TableHead>顧客・予約</TableHead>
                    <TableHead>宛先</TableHead>
                    <TableHead>状態</TableHead>
                    <TableHead className="text-right"><span className="sr-only">操作</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs tabular">{formatInZone(r.createdAt, tz, "yyyy/MM/dd HH:mm")}</TableCell>
                      <TableCell className="whitespace-nowrap">{NOTIFICATION_LABELS[r.type]}</TableCell>
                      <TableCell>
                        <span className="block">{r.customerName ?? "—"}</span>
                        {r.startsAt && (
                          r.bookingId
                            ? <Link href={`/bookings/${r.bookingId}`} className="text-xs text-primary hover:underline tabular">{formatInZone(r.startsAt, tz, "M/d(E) HH:mm")}の予約</Link>
                            : <span className="text-xs text-muted-foreground tabular">{formatInZone(r.startsAt, tz, "M/d(E) HH:mm")}の予約</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[14rem] truncate text-xs">{r.recipient ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        <StateBadge state={r.status} />
                        {r.lastError && <span className="mt-1 block max-w-[16rem] text-xs text-muted-foreground">{r.lastError}</span>}
                        {r.status === "failed" && <span className="block text-xs text-muted-foreground">試行 {r.attempts} 回</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <div className="flex justify-end gap-1">
                          {r.subject && r.body && <NotificationBodyButton subject={r.subject} body={r.body} recipient={r.recipient} label={NOTIFICATION_LABELS[r.type]} />}
                          {r.status === "failed" && r.deliveryId && <RetryButton deliveryId={r.deliveryId} />}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="border-t">
              <Pagination page={Math.min(p.page, pageCount)} pageCount={pageCount} total={list.total} pageSize={PAGE_SIZE} hrefFor={(n) => hrefWith(p, { page: n })} />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
