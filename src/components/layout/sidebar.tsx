"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MemberRole } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";
import { isActive, navFor } from "./nav";
import { Logo } from "./logo";

export function SidebarNav({ role, onNavigate }: { role: MemberRole; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="メインメニュー" className="flex flex-col gap-0.5 px-3">
      {navFor(role).map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand",
              active
                ? "bg-sidebar-accent text-white shadow-[inset_3px_0_0_var(--brand)]"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white",
            )}
          >
            <item.icon className={cn("size-4.5 shrink-0", active ? "text-white" : "text-sidebar-muted group-hover:text-white")} aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SidebarBody({ role, organizationName, onNavigate }: { role: MemberRole; organizationName: string; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="px-5 pt-5 pb-6">
        <Logo inverted />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <SidebarNav role={role} onNavigate={onNavigate} />
      </div>
      <div className="border-t border-sidebar-border px-5 py-4">
        <div className="text-[11px] text-sidebar-muted">ご利用中の企業</div>
        <div className="text-keep mt-0.5 text-sm font-medium text-white">{organizationName}</div>
      </div>
    </div>
  );
}

export function Sidebar({ role, organizationName }: { role: MemberRole; organizationName: string }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
      <SidebarBody role={role} organizationName={organizationName} />
    </aside>
  );
}
