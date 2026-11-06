import "server-only";
import type { Tx } from "@/lib/db";
import { loadSchedulingContext, loadServiceSpecs } from "@/lib/scheduling/load";
import { DEFAULT_WEIGHTS, suggestSlots, type Suggestion, type SuggestionWeights } from "@/lib/suggestions/engine";
import { addDays } from "@/lib/time";

export async function getSuggestionWeights(tx: Tx, locationId: string): Promise<SuggestionWeights> {
  const [r] = await tx<{ weight_preferred_time: number; weight_gap: number; weight_balance: number; weight_idle: number }[]>`
    select weight_preferred_time, weight_gap, weight_balance, weight_idle from public.tenant_settings where location_id = ${locationId}`;
  if (!r) return DEFAULT_WEIGHTS;
  return { preferredTime: r.weight_preferred_time, gap: r.weight_gap, balance: r.weight_balance, idle: r.weight_idle };
}

export type SuggestionQuery = {
  serviceId: string;
  date: string;
  searchDays: number;
  window?: { from: string; to: string };
  preferredTime?: string;
  staffId?: string;
  count: number;
};

/**
 * 空き枠の候補をおすすめ順に返す。入力は予約登録と同じ（勤務・休暇・営業時間・既存予約・設備・受付設定）。
 * サービスが見つからなければ null。
 */
export async function findSuggestions(tx: Tx, locationId: string, q: SuggestionQuery, now = new Date()): Promise<{ suggestions: Suggestion[]; weights: SuggestionWeights; timezone: string } | null> {
  const [ctx, services, weights] = await Promise.all([
    loadSchedulingContext(tx, locationId, q.date, addDays(q.date, q.searchDays - 1)),
    loadServiceSpecs(tx, locationId),
    getSuggestionWeights(tx, locationId),
  ]);
  const service = services.find((s) => s.id === q.serviceId);
  if (!ctx || !service) return null;
  // この店舗で最も短いサービスの占有時間。これより短い空きは、ほかの予約が入らない「半端な隙間」
  const minUsableMinutes = Math.min(...services.map((s) => s.durationMinutes + s.bufferBeforeMinutes + s.bufferAfterMinutes));
  const suggestions = suggestSlots(ctx, service, {
    date: q.date, searchDays: q.searchDays, window: q.window, preferredTime: q.preferredTime, staffId: q.staffId ?? null,
    count: q.count, now: now.getTime(), minUsableMinutes,
  }, weights);
  return { suggestions, weights, timezone: ctx.timezone };
}
