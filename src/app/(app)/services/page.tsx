import type { Metadata } from "next";
import { Boxes, Tags } from "lucide-react";
import { ConfirmDeleteButton } from "@/components/common/confirm-delete-button";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ResourceFormDialog } from "@/components/services/resource-form-dialog";
import { ServiceFormDialog } from "@/components/services/service-form-dialog";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deleteResource, deleteService } from "@/lib/actions/services";
import { requirePermission } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { formatYen } from "@/lib/format";
import { RESOURCE_KINDS } from "@/lib/validation/service";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "メニュー・サービス" };

type ServiceRow = {
  id: string; name: string; category: string | null; description: string | null; price: number; duration_minutes: number;
  buffer_before_minutes: number; buffer_after_minutes: number; color: string; is_public: boolean; is_active: boolean;
  staff_ids: string[]; resource_ids: string[]; bookings: number;
};

export default async function ServicesPage() {
  const ctx = await requirePermission("services.manage");
  const { services, staff, resources } = await asUser(ctx.userId, async (tx) => {
    const [services, staff, resources] = await Promise.all([
      tx<ServiceRow[]>`
        select s.id, s.name, s.category, s.description, s.price, s.duration_minutes, s.buffer_before_minutes, s.buffer_after_minutes,
               s.color, s.is_public, s.is_active,
               array(select ss.staff_id from public.service_staff ss where ss.service_id = s.id) staff_ids,
               array(select sr.resource_id from public.service_resources sr where sr.service_id = s.id) resource_ids,
               (select count(*)::int from public.bookings b where b.service_id = s.id) bookings
          from public.services s where s.location_id = ${ctx.location.id}
         order by s.is_active desc, s.sort_order, s.name`,
      tx<{ id: string; name: string; is_active: boolean }[]>`select id, name, is_active from public.staff where location_id = ${ctx.location.id} order by sort_order, name`,
      tx<{ id: string; name: string; kind: "room" | "seat" | "equipment"; is_active: boolean; services: number; bookings: number }[]>`
        select r.id, r.name, r.kind, r.is_active,
               (select count(*)::int from public.service_resources sr where sr.resource_id = r.id) services,
               (select count(*)::int from public.booking_resources br where br.resource_id = r.id) bookings
          from public.resources r where r.location_id = ${ctx.location.id} order by r.is_active desc, r.sort_order, r.name`,
    ]);
    return { services, staff, resources };
  });
  const activeStaff = staff.filter((s) => s.is_active).map((s) => ({ id: s.id, name: s.name }));
  const activeResources = resources.filter((r) => r.is_active).map((r) => ({ id: r.id, name: r.name }));
  const categories = [...new Set(services.map((s) => s.category).filter((c): c is string => !!c))];
  const names = (ids: string[], list: { id: string; name: string }[]) => list.filter((x) => ids.includes(x.id)).map((x) => x.name).join("、");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="メニュー・サービス"
        description="予約できるサービスと、サービスで使う設備（部屋・ベッド・機材など）を管理します。"
        actions={<ServiceFormDialog staff={activeStaff} resources={activeResources} categories={categories} />}
      />
      <Card className="gap-0 overflow-hidden pb-0">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2"><Tags className="size-4" aria-hidden />サービス</CardTitle>
          <CardDescription>予約のあるサービスは削除できません。提供をやめるときは編集で「停止中」にします。</CardDescription>
        </CardHeader>
        {services.length === 0 ? (
          <EmptyState title="サービスがありません" description="「サービスを追加」から登録してください。" />
        ) : (
          <div className="overflow-x-auto border-t">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>サービス</TableHead>
                  <TableHead className="text-right">料金</TableHead>
                  <TableHead className="text-right">所要時間</TableHead>
                  <TableHead>担当・設備</TableHead>
                  <TableHead>状態</TableHead>
                  <TableHead className="w-20"><span className="sr-only">操作</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {services.map((s) => (
                  <TableRow key={s.id} className={cn(!s.is_active && "text-muted-foreground")}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
                        <span className="font-medium">{s.name}</span>
                      </div>
                      {s.category && <span className="ml-4.5 text-xs text-muted-foreground">{s.category}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular">{formatYen(s.price)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular">
                      {s.duration_minutes}分
                      {(s.buffer_before_minutes > 0 || s.buffer_after_minutes > 0) && (
                        <span className="block text-xs text-muted-foreground">準備{s.buffer_before_minutes}・片付け{s.buffer_after_minutes}分</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-72 text-xs">
                      {staff.length > 0 && <span className="block truncate">担当：{names(s.staff_ids, staff) || <span className="text-destructive">未設定</span>}</span>}
                      {s.resource_ids.length > 0 && <span className="block truncate text-muted-foreground">設備：{names(s.resource_ids, resources)}</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {s.is_active ? "提供中" : "停止中"}{s.is_active && !s.is_public && "（店頭のみ）"}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <ServiceFormDialog staff={activeStaff} resources={activeResources} categories={categories} initial={{
                          id: s.id, name: s.name, category: s.category, description: s.description, price: s.price, durationMinutes: s.duration_minutes,
                          bufferBeforeMinutes: s.buffer_before_minutes, bufferAfterMinutes: s.buffer_after_minutes, color: s.color, isPublic: s.is_public,
                          isActive: s.is_active, staffIds: s.staff_ids, resourceIds: s.resource_ids,
                        }} />
                        {s.bookings === 0 && (
                          <ConfirmDeleteButton label={`${s.name}を削除`} title={`「${s.name}」を削除しますか？`} description="元に戻せません。"
                            action={deleteService.bind(null, s.id)} />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <Card className="gap-0 overflow-hidden pb-0">
        <CardHeader className="flex-row items-start justify-between gap-4 pb-4">
          <div className="grid gap-1.5">
            <CardTitle className="flex items-center gap-2"><Boxes className="size-4" aria-hidden />設備</CardTitle>
            <CardDescription>同じ時間に1件しか使えないもの。予約時に空いている設備を自動で割り当て、重なりはデータベースが拒否します。</CardDescription>
          </div>
          <ResourceFormDialog />
        </CardHeader>
        {resources.length === 0 ? (
          <EmptyState icon={Boxes} title="設備は登録されていません" description="部屋やベッドの数で予約を制限したいときに追加します。" />
        ) : (
          <ul className="divide-y border-t">
            {resources.map((r) => (
              <li key={r.id} className={cn("flex items-center gap-3 px-6 py-3 text-sm", !r.is_active && "text-muted-foreground")}>
                <span className="font-medium">{r.name}</span>
                <span className="text-xs text-muted-foreground">{RESOURCE_KINDS[r.kind]}・サービス{r.services}件{r.is_active ? "" : "・停止中"}</span>
                <div className="ml-auto flex">
                  <ResourceFormDialog initial={{ id: r.id, name: r.name, kind: r.kind, isActive: r.is_active }} />
                  {r.bookings === 0 && (
                    <ConfirmDeleteButton label={`${r.name}を削除`} title={`「${r.name}」を削除しますか？`} description="元に戻せません。" action={deleteResource.bind(null, r.id)} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
