/**
 * 役割ごとにできること（画面の表示・サーバーの処理で共通に使う。DB 側は RLS と DB 関数で同じ内容を判定する）。
 * ブラウザからも読めるよう、サーバー専用の処理は含めない。
 */
export type MemberRole = "owner" | "manager" | "staff";

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "オーナー",
  manager: "マネージャー",
  staff: "スタッフ",
};

const MATRIX = {
  /** 店舗のすべての予約を見る（staff は自分の担当だけ） */
  "bookings.viewAll": ["owner", "manager"],
  /** 予約の作成・変更・キャンセル */
  "bookings.manage": ["owner", "manager"],
  /** 担当予約のステータス更新（staff は自分の担当だけ） */
  "bookings.updateStatus": ["owner", "manager", "staff"],
  /** 顧客をすべて見る（staff は担当した顧客だけ） */
  "customers.viewAll": ["owner", "manager"],
  "customers.manage": ["owner", "manager"],
  /** スタッフの登録・役割・担当サービス */
  "staff.manage": ["owner"],
  /** スタッフの勤務時間・休暇 */
  "staff.schedule": ["owner", "manager"],
  "services.manage": ["owner"],
  /** 売上の金額（売上分析・売上 KPI） */
  "sales.view": ["owner"],
  /** 予約・顧客の分析（無断キャンセル・リピート率など） */
  "analytics.view": ["owner", "manager"],
  "suggestions.use": ["owner", "manager"],
  "notifications.view": ["owner", "manager"],
  "settings.manage": ["owner"],
} as const satisfies Record<string, readonly MemberRole[]>;

export type Permission = keyof typeof MATRIX;

export function can(role: MemberRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (MATRIX[permission] as readonly MemberRole[]).includes(role);
}
