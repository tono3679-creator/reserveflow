import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付の形式が正しくありません");

export const availabilityQuerySchema = z.object({
  service: z.uuid(),
  staff: z.union([z.uuid(), z.literal("any")]).default("any"),
  date: date.optional(),
  from: date.optional(),
  days: z.coerce.number().int().min(1).max(31).default(14),
  manage: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
});

export const customerInfoSchema = z.object({
  name: z.string().trim().min(1, "お名前を入力してください").max(60, "60文字以内で入力してください"),
  nameKana: z.string().trim().max(60, "60文字以内で入力してください").nullish().transform((v) => v || null),
  phone: z.string().trim().min(1, "電話番号を入力してください").max(20, "20文字以内で入力してください")
    .regex(/^[0-9+() -]{6,20}$/, "電話番号は数字とハイフンで入力してください"),
  email: z.string().trim().min(1, "メールアドレスを入力してください").max(254)
    .pipe(z.email("メールアドレスの形式で入力してください")),
  message: z.string().trim().max(500, "500文字以内で入力してください").nullish().transform((v) => v || null),
});
export type CustomerInfoInput = z.input<typeof customerInfoSchema>;

export const publicBookingSchema = z.object({
  serviceId: z.uuid(),
  staffId: z.uuid().nullable(),
  startsAt: z.iso.datetime({ offset: true }),
  customer: customerInfoSchema,
  agreed: z.literal(true, { message: "キャンセルポリシーへの同意が必要です" }),
});

export const manageActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel"), reason: z.string().trim().max(500).transform((v) => v || null) }),
  z.object({ action: z.literal("reschedule"), startsAt: z.iso.datetime({ offset: true }), staffId: z.uuid().nullable() }),
]);
