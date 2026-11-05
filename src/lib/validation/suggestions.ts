import { z } from "zod";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const SEARCH_DAYS = [1, 3, 7] as const;
export const SUGGESTION_COUNTS = [3, 5, 10] as const;

/** 空き枠提案の検索条件（URL のクエリ）。不正な値は既定値に戻す */
export const suggestionParamsSchema = z.object({
  service: z.uuid().optional().catch(undefined),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  from: time.optional().catch(undefined),
  to: time.optional().catch(undefined),
  time: time.optional().catch(undefined),
  staff: z.uuid().optional().catch(undefined),
  days: z.coerce.number().int().refine((n) => (SEARCH_DAYS as readonly number[]).includes(n)).catch(3),
  count: z.coerce.number().int().refine((n) => (SUGGESTION_COUNTS as readonly number[]).includes(n)).catch(5),
});
export type SuggestionParams = z.infer<typeof suggestionParamsSchema>;

const weight = z.number({ message: "0〜100 の整数で入力してください" }).int("整数で入力してください").min(0, "0以上にしてください").max(100, "100以下にしてください");

/** スコアの重み（店舗設定） */
export const suggestionWeightsSchema = z.object({
  preferredTime: weight, gap: weight, balance: weight, idle: weight,
}).refine((w) => w.preferredTime + w.gap + w.balance + w.idle > 0, { message: "どれか1つは 1 以上にしてください", path: ["preferredTime"] });
export type SuggestionWeightsInput = z.infer<typeof suggestionWeightsSchema>;
