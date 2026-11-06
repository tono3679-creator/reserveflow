import { z } from "zod";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "時刻を選んでください");
const optionalTime = z.string().transform((v) => v || null).pipe(time.nullable());

export const STAFF_COLORS = ["#2563eb", "#16a34a", "#db2777", "#d97706", "#7c3aed", "#0891b2", "#dc2626", "#4f46e5", "#0d9488", "#64748b"] as const;

export const staffFormSchema = z.object({
  name: z.string().trim().min(1, "氏名を入力してください").max(60, "60文字以内で入力してください"),
  title: z.string().trim().max(40, "40文字以内で入力してください").transform((v) => v || null),
  email: z.string().trim().max(254).transform((v) => v || null)
    .refine((v) => v === null || z.email().safeParse(v).success, "メールアドレスの形式で入力してください"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "色を選んでください"),
  isActive: z.boolean(),
  serviceIds: z.array(z.uuid()).max(200),
});
export type StaffFormInput = z.input<typeof staffFormSchema>;

export const staffScheduleSchema = z.object({
  days: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    working: z.boolean(),
    start: time,
    end: time,
    breakStart: optionalTime,
    breakEnd: optionalTime,
  })).length(7),
}).superRefine((value, ctx) => {
  value.days.forEach((d, i) => {
    if (!d.working) return;
    if (d.start >= d.end) ctx.addIssue({ code: "custom", path: ["days", i, "end"], message: "終了は開始より後にしてください" });
    if ((d.breakStart === null) !== (d.breakEnd === null)) {
      ctx.addIssue({ code: "custom", path: ["days", i, "breakEnd"], message: "休憩は開始と終了の両方を入れてください" });
    } else if (d.breakStart && d.breakEnd && !(d.start <= d.breakStart && d.breakStart < d.breakEnd && d.breakEnd <= d.end)) {
      ctx.addIssue({ code: "custom", path: ["days", i, "breakEnd"], message: "休憩は勤務時間の中に入れてください" });
    }
  });
});
export type StaffScheduleInput = z.input<typeof staffScheduleSchema>;

export const timeOffSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付を選んでください"),
  kind: z.enum(["day_off", "custom_hours"]),
  start: optionalTime,
  end: optionalTime,
  reason: z.string().trim().max(200, "200文字以内で入力してください").transform((v) => v || null),
}).superRefine((v, ctx) => {
  if (v.kind === "custom_hours") {
    if (!v.start) ctx.addIssue({ code: "custom", path: ["start"], message: "開始を選んでください" });
    if (!v.end) ctx.addIssue({ code: "custom", path: ["end"], message: "終了を選んでください" });
    if (v.start && v.end && v.start >= v.end) ctx.addIssue({ code: "custom", path: ["end"], message: "終了は開始より後にしてください" });
  }
});
export type TimeOffInput = z.input<typeof timeOffSchema>;
