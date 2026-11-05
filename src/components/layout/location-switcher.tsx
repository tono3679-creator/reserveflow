"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Loader2, Store } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { switchLocation } from "@/lib/actions/auth";
import { industryLabel } from "@/lib/domain/industry";

export type LocationOption = { id: string; name: string; industry: string; organizationName: string; roleLabel: string };

/** 店舗（テナント）の切り替え。所属する企業の店舗だけが並ぶ */
export function LocationSwitcher({ locations, currentId }: { locations: LocationOption[]; currentId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const current = locations.find((l) => l.id === currentId) ?? locations[0];
  const select = (id: string) =>
    startTransition(async () => {
      const result = await switchLocation(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-10 min-w-0 max-w-[60vw] justify-start gap-2 px-2.5 sm:max-w-xs" aria-label="店舗を切り替える">
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Store className="text-brand" aria-hidden />}
          <span className="min-w-0 flex-1 text-left leading-tight">
            <span className="block truncate text-sm font-semibold">{current.name}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{industryLabel(current.industry)}・{current.roleLabel}</span>
          </span>
          <ChevronsUpDown className="text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>店舗を切り替える</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {locations.map((l) => (
          <DropdownMenuItem key={l.id} disabled={pending} onSelect={() => l.id !== currentId && select(l.id)}>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{l.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{industryLabel(l.industry)}・{l.organizationName}</span>
            </span>
            {l.id === currentId && <Check className="text-brand" aria-label="選択中" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
