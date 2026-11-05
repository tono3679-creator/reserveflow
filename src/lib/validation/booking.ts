import { z } from "zod";

const uuid = z.uuid("選択してください");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付を選んでください");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "時刻を選んでください");

export const bookingFormSchema = z.object({
  customerId: uuid,
  serviceId: uuid,
  staffId: z.uuid().nullable(),
  date,
  startTime: time,
  endTime: time,
  price: z.number({ message: "料金を入力してください" }).int("整数で入力してください").min(0, "0円以上にしてください").max(10_000_000, "1,000万円以下にしてください"),
  notes: z.string().trim().max(1000, "1000文字以内で入力してください"),
  status: z.enum(["confirmed", "checked_in", "completed"]),
  /** 営業時間外・勤務時間外などの確認を済ませたか */
  confirmWarnings: z.boolean(),
}).refine((v) => v.startTime < v.endTime, { path: ["endTime"], message: "終了は開始より後にしてください" });
export type BookingFormInput = z.infer<typeof bookingFormSchema>;

export const moveBookingSchema = z.object({
  bookingId: z.uuid(),
  version: z.number().int().min(1),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  staffId: z.uuid().nullable().optional(),
  confirmWarnings: z.boolean(),
});

export const statusChangeSchema = z.object({
  bookingId: z.uuid(),
  version: z.number().int().min(1),
  status: z.enum(["confirmed", "checked_in", "completed", "cancelled_customer", "cancelled_store", "no_show"]),
  reason: z.string().trim().max(500, "500文字以内で入力してください"),
});

export const customerFormSchema = z.object({
  name: z.string().trim().min(1, "氏名を入力してください").max(60, "60文字以内で入力してください"),
  nameKana: z.string().trim().max(60, "60文字以内で入力してください").transform((v) => v || null),
  phone: z.string().trim().max(20).transform((v) => v || null)
    .refine((v) => v === null || /^[0-9+() -]{6,20}$/.test(v), "電話番号は数字とハイフンで入力してください"),
  email: z.string().trim().max(254).transform((v) => v || null)
    .refine((v) => v === null || z.email().safeParse(v).success, "メールアドレスの形式で入力してください"),
  preferredStaffId: z.string().transform((v) => v || null).pipe(z.uuid().nullable()),
});
export type CustomerFormInput = z.input<typeof customerFormSchema>;
