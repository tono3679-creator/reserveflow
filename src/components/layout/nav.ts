import {
  LayoutDashboard, CalendarDays, ListChecks, Users, UserCog, Tags, ChartColumn, ChartPie, Sparkles, Bell, Settings,
  type LucideIcon,
} from "lucide-react";
import { can, type MemberRole, type Permission } from "@/lib/auth/roles";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** この権限がある役割にだけ表示する（無ければ全員） */
  permission?: Permission;
};

/**
 * サイドバーの項目（仕様の11項目）。
 * 実装が済んだ画面だけを IMPLEMENTED に入れる（未実装の画面へのリンクは出さない）。
 */
export const NAV: NavItem[] = [
  { href: "/dashboard", label: "ダッシュボード", icon: LayoutDashboard },
  { href: "/calendar", label: "予約カレンダー", icon: CalendarDays },
  { href: "/bookings", label: "予約一覧", icon: ListChecks },
  { href: "/customers", label: "顧客管理", icon: Users },
  { href: "/staff", label: "スタッフ管理", icon: UserCog, permission: "staff.schedule" },
  { href: "/services", label: "メニュー・サービス", icon: Tags, permission: "services.manage" },
  { href: "/analytics/sales", label: "売上分析", icon: ChartColumn, permission: "sales.view" },
  { href: "/analytics/customers", label: "顧客分析", icon: ChartPie, permission: "analytics.view" },
  { href: "/suggestions", label: "スマート空き枠提案", icon: Sparkles, permission: "suggestions.use" },
  { href: "/notifications", label: "通知管理", icon: Bell, permission: "notifications.view" },
  { href: "/settings", label: "店舗設定", icon: Settings, permission: "settings.manage" },
];

const IMPLEMENTED = new Set(["/dashboard", "/calendar", "/bookings", "/customers", "/staff", "/services", "/analytics/sales", "/analytics/customers", "/suggestions", "/notifications", "/settings"]);

export function navFor(role: MemberRole): NavItem[] {
  return NAV.filter((item) => IMPLEMENTED.has(item.href) && (!item.permission || can(role, item.permission)));
}

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
