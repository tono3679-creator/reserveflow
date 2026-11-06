import { z } from "zod";

export const serviceFormSchema = z.object({
  name: z.string().trim().min(1, "サービス名を入力してください").max(80, "80文字以内で入力してください"),
  category: z.string().trim().max(40, "40文字以内で入力してください").transform((v) => v || null),
  description: z.string().trim().max(1000, "1000文字以内で入力してください").transform((v) => v || null),
  price: z.number({ message: "料金を入力してください" }).int("整数で入力してください").min(0, "0円以上にしてください").max(10_000_000, "1,000万円以下にしてください"),
  durationMinutes: z.number({ message: "所要時間を入力してください" }).int().min(5, "5分以上にしてください").max(720, "12時間以内にしてください")
    .refine((v) => v % 5 === 0, "5分単位で入力してください"),
  bufferBeforeMinutes: z.number({ message: "0〜120分で入力してください" }).int().min(0, "0分以上にしてください").max(120, "120分以内にしてください"),
  bufferAfterMinutes: z.number({ message: "0〜120分で入力してください" }).int().min(0, "0分以上にしてください").max(120, "120分以内にしてください"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "色を選んでください"),
  isPublic: z.boolean(),
  isActive: z.boolean(),
  staffIds: z.array(z.uuid()).max(200),
  resourceIds: z.array(z.uuid()).max(200),
});
export type ServiceFormInput = z.input<typeof serviceFormSchema>;

export const RESOURCE_KINDS = { room: "部屋", seat: "席・ベッド", equipment: "機材" } as const;

export const resourceFormSchema = z.object({
  name: z.string().trim().min(1, "設備名を入力してください").max(60, "60文字以内で入力してください"),
  kind: z.enum(["room", "seat", "equipment"]),
  isActive: z.boolean(),
});
export type ResourceFormInput = z.input<typeof resourceFormSchema>;
