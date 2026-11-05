/**
 * 空き枠エンジンの入力と出力（画面にも DB にも依存しない）。
 * 時刻はすべて UTC のミリ秒（epoch ms）。日付は店舗のタイムゾーンでの 'YYYY-MM-DD'、時刻は 'HH:MM'。
 */

export type Interval = { start: number; end: number };

export type WeeklyHours = { weekday: number; opens: string; closes: string };

export type HoursException = { date: string; isClosed: boolean; opens?: string | null; closes?: string | null };

export type StaffSchedule = { weekday: number; start: string; end: string; breakStart?: string | null; breakEnd?: string | null };

export type StaffTimeOff = { date: string; kind: "day_off" | "custom_hours"; start?: string | null; end?: string | null };

export type StaffInfo = {
  id: string;
  name: string;
  schedules: StaffSchedule[];
  timeOff: StaffTimeOff[];
};

export type ResourceInfo = { id: string; name: string };

/** 枠を占有している既存の予約（キャンセル済みは含めない）。start/end は前後バッファを含む占有時間 */
export type BusyBooking = { id: string; staffId: string | null; resourceIds: string[]; start: number; end: number };

export type SchedulingContext = {
  timezone: string;
  slotIntervalMinutes: number;
  minLeadMinutes: number;
  maxAdvanceDays: number;
  staffSelection: "required" | "optional" | "none";
  businessHours: WeeklyHours[];
  exceptions: HoursException[];
  staff: StaffInfo[];
  resources: ResourceInfo[];
  bookings: BusyBooking[];
};

export type ServiceSpec = {
  id: string;
  name: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  /** 対応できるスタッフ */
  staffIds: string[];
  /** 必要な設備（このうちどれか1つ）。空なら設備は不要 */
  resourceIds: string[];
};

/** 予約しようとしている枠の問題点 */
export type SlotIssueCode =
  | "closed_day"            // 定休日・臨時休業
  | "outside_hours"         // 営業時間外
  | "staff_required"        // スタッフの指定が必要
  | "staff_not_assigned"    // サービスを担当していない
  | "staff_day_off"         // 休暇
  | "staff_outside_hours"   // 勤務時間外
  | "staff_break"           // 休憩と重なる
  | "staff_conflict"        // 既存の予約と重なる
  | "resource_unavailable"  // 必要な設備が空いていない
  | "lead_time"             // 受付の締め切りを過ぎている
  | "too_far_ahead"         // 受付期間より先
  | "in_past";              // 過去の時刻

export type SlotIssue = { code: SlotIssueCode; message: string };
