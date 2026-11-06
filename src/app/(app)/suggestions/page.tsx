import type { Metadata } from "next";
import Link from "next/link";
import { CalendarX2, Info, Settings2 } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SuggestionForm, type SuggestionFormValues } from "@/components/suggestions/suggestion-form";
import { SuggestionList, type SuggestionView } from "@/components/suggestions/suggestion-list";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/auth/roles";
import { getBookingOptions } from "@/lib/data/bookings";
import { findSuggestions } from "@/lib/data/suggestions";
import { asUser } from "@/lib/db";
import { formatInZone } from "@/lib/format";
import { FACTOR_LABELS, SCORING_RULES, slotTimes } from "@/lib/suggestions/engine";
import { localDate, toMinutes, zonedDateTime } from "@/lib/time";
import { suggestionParamsSchema } from "@/lib/validation/suggestions";

export const metadata: Metadata = { title: "スマート空き枠提案" };

export default async function SuggestionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePermission("suggestions.use");
  const tz = ctx.location.timezone;
  const today = localDate(new Date(), tz);
  const raw = await searchParams;
  const p = suggestionParamsSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v || undefined])));

  const options = await asUser(ctx.userId, (tx) => getBookingOptions(tx, ctx.location.id));
  const service = options.services.find((s) => s.id === p.service) ?? options.services[0];
  const date = p.date && p.date >= today ? p.date : today;
  const window = p.from && p.to && toMinutes(p.from) < toMinutes(p.to) ? { from: p.from, to: p.to } : undefined;
  const staffId = p.staff && service?.staffIds.includes(p.staff) && options.staffSelection !== "none" ? p.staff : undefined;
  const notes: string[] = [];
  if (p.date && p.date < today) notes.push("過去の日付は探せないため、今日から探しています。");
  if ((p.from || p.to) && !window) notes.push("希望時間帯は「開始」と「まで」の両方を、開始が早くなるように指定してください（今回は時間帯を絞り込んでいません）。");
  if (p.staff && !staffId) notes.push("指定したスタッフはこのサービスを担当していないため、スタッフを指定せずに探しています。");

  const result = service
    ? await asUser(ctx.userId, (tx) => findSuggestions(tx, ctx.location.id, {
        serviceId: service.id, date, searchDays: p.days, window, preferredTime: p.time, staffId, count: p.count,
      }))
    : null;

  const values: SuggestionFormValues = {
    service: service?.id ?? "", date, from: window?.from ?? "", to: window?.to ?? "", time: p.time ?? "", staff: staffId ?? "", days: p.days, count: p.count,
  };
  const items: SuggestionView[] = (result?.suggestions ?? []).map((s) => {
    const { start, end } = slotTimes(s, tz);
    return {
      key: `${s.start}-${s.staffId ?? ""}`,
      date: s.date,
      dateLabel: formatInZone(zonedDateTime(s.date, "12:00", tz), tz, "M月d日(E)"),
      start, end, staffId: s.staffId, staffName: s.staffName, resourceName: s.resourceName, score: s.score, reasons: s.reasons,
      factors: s.factors.map((f) => ({ key: f.key, label: FACTOR_LABELS[f.key], value: f.value, points: f.points, weight: f.weight })),
    };
  });
  const locations = ctx.locations.filter((l) => can(l.role, "suggestions.use")).map((l) => ({ id: l.id, name: l.name }));
  const w = result?.weights;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="スマート空き枠提案"
        description="勤務時間・営業時間・既存の予約・サービスの所要時間と前後の準備時間・必要な設備・受付期限から、予約できる枠を探しておすすめ順に並べます。"
        actions={can(ctx.role, "settings.manage") ? (
          <Button variant="outline" size="sm" asChild><Link href="/settings"><Settings2 aria-hidden />重みの設定</Link></Button>
        ) : undefined}
      />

      {options.services.length === 0 ? (
        <EmptyState icon={CalendarX2} title="有効なサービスがありません" description="メニュー・サービス管理でサービスを登録すると、空き枠を探せます。" />
      ) : (
        <SuggestionForm options={options} values={values} today={today} locations={locations} currentLocationId={ctx.location.id} />
      )}

      {notes.length > 0 && (
        <ul className="grid gap-1 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm" role="status">
          {notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}

      {service && result && (
        <section aria-labelledby="sg-results" className="grid gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="sg-results" className="text-base font-semibold">おすすめ予約枠</h2>
            <p className="text-sm text-muted-foreground">{service.name}（{service.durationMinutes}分）・{items.length}件</p>
          </div>
          {items.length === 0 ? (
            <div className="rounded-xl border bg-card">
              <EmptyState
                icon={CalendarX2}
                title="条件に合う空き枠がありません"
                description="探す範囲を広げる、希望時間帯やスタッフの指定を外す、別の日を選ぶなどで探し直してください。"
              />
            </div>
          ) : (
            <SuggestionList items={items} options={options} serviceId={service.id} canCreateCustomer={can(ctx.role, "customers.manage")} />
          )}
        </section>
      )}

      <section aria-labelledby="sg-rules" className="grid gap-2 rounded-xl border bg-muted/40 p-4 text-sm">
        <h2 id="sg-rules" className="flex items-center gap-1.5 font-semibold"><Info className="size-4" aria-hidden />候補の選び方</h2>
        <p className="text-muted-foreground">
          予約登録と同じ判定（営業時間・定休日・勤務・担当サービス・休憩・休暇・既存予約・所要時間・前後の準備時間・設備・受付期限）を満たす枠だけを候補にします。
          同じ開始時刻に複数のスタッフが空いている場合は、点数の高い1件にまとめます。
        </p>
        <ul className="grid gap-1 text-muted-foreground">
          <li>・{FACTOR_LABELS.preferredTime}：希望時刻との差が {SCORING_RULES.proximityZeroMinutes / 60} 時間で 0、希望日から1日離れるごとに {SCORING_RULES.dayPenalty} 下げます{w ? `（重み ${w.preferredTime}）` : ""}</li>
          <li>・{FACTOR_LABELS.gap}：前後に、この店舗で最も短いサービスも入らない半端な空きを残すと低くなります{w ? `（重み ${w.gap}）` : ""}</li>
          <li>・{FACTOR_LABELS.balance}：その日の担当スタッフの稼働率が低いほど高くなります{w ? `（重み ${w.balance}）` : ""}</li>
          <li>・{FACTOR_LABELS.idle}：その時間帯に手が空いているスタッフ（設備）の割合が高いほど高くなります{w ? `（重み ${w.idle}）` : ""}</li>
        </ul>
        <p className="text-muted-foreground">表示した空き状況は予約の保証ではありません。予約の登録時にもう一度判定し、埋まっていれば登録できません。</p>
      </section>
    </div>
  );
}
