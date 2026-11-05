import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max, `${max}文字以内で入力してください`).transform((v) => v || null);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "時刻を選んでください");

export const TIMEZONES = ["Asia/Tokyo", "Asia/Seoul", "Asia/Taipei", "Asia/Singapore", "Asia/Bangkok", "Australia/Sydney", "Pacific/Honolulu"] as const;

export const locationInfoSchema = z.object({
  name: z.string().trim().min(1, "店舗名を入力してください").max(100, "100文字以内で入力してください"),
  phone: optionalText(20).refine((v) => v === null || /^[0-9+() -]{6,20}$/.test(v), "電話番号は数字とハイフンで入力してください"),
  email: optionalText(254).refine((v) => v === null || z.email().safeParse(v).success, "メールアドレスの形式で入力してください"),
  address: optionalText(200),
  logoUrl: optionalText(500).refine((v) => v === null || /^https:\/\/\S+$/.test(v), "https:// で始まる画像の URL を入力してください"),
  timezone: z.enum(TIMEZONES, { message: "タイムゾーンを選んでください" }),
});
export type LocationInfoInput = z.input<typeof locationInfoSchema>;

export const businessHoursSchema = z.object({
  days: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    open: z.boolean(),
    opensAt: time,
    closesAt: time,
  })).length(7),
}).superRefine((value, ctx) => {
  value.days.forEach((d, i) => {
    if (d.open && d.opensAt >= d.closesAt) {
      ctx.addIssue({ code: "custom", path: ["days", i, "closesAt"], message: "終了は開始より後にしてください" });
    }
  });
});
export type BusinessHoursInput = z.infer<typeof businessHoursSchema>;

export const bookingRulesSchema = z.object({
  publicBookingEnabled: z.boolean(),
  staffSelection: z.enum(["required", "optional", "none"]),
  slotIntervalMinutes: z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(60)]),
  minLeadMinutes: z.number().int().min(0, "0以上にしてください").max(10080, "7日（10080分）以内にしてください"),
  maxAdvanceDays: z.number().int().min(1, "1日以上にしてください").max(365, "365日以内にしてください"),
  cancelDeadlineHours: z.number().int().min(0, "0以上にしてください").max(720, "720時間以内にしてください"),
  cancellationPolicy: z.string().trim().max(2000, "2000文字以内で入力してください"),
  remindDayBefore: z.boolean(),
  remindSameDay: z.boolean(),
});
export type BookingRulesInput = z.infer<typeof bookingRulesSchema>;
