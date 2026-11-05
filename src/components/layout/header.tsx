"use client";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { MemberRole } from "@/lib/auth/roles";
import { SidebarBody } from "./sidebar";
import { LocationSwitcher, type LocationOption } from "./location-switcher";
import { UserMenu } from "./user-menu";

export function Header({
  role, displayName, organizationName, isDemo, locations, currentLocationId, today,
}: {
  role: MemberRole;
  displayName: string;
  organizationName: string;
  isDemo: boolean;
  locations: LocationOption[];
  currentLocationId: string;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b bg-card/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:gap-3 sm:px-6">
      {/* スマートフォン・タブレットではサイドバーをドロワーにする */}
      <Sheet open={open} onOpenChange={setOpen}>
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="メニューを開く">
          <Menu />
        </Button>
        <SheetContent side="left" aria-describedby={undefined}>
          <SheetTitle className="sr-only">メインメニュー</SheetTitle>
          <SidebarBody role={role} organizationName={organizationName} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <LocationSwitcher locations={locations} currentId={currentLocationId} />
      <div className="hidden min-w-0 flex-1 text-sm text-muted-foreground tabular md:block">{today}</div>
      <div className="ml-auto flex items-center gap-1">
        <UserMenu displayName={displayName} role={role} isDemo={isDemo} />
      </div>
    </header>
  );
}
