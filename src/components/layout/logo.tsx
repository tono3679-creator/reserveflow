import { CalendarCheck2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Logo({ inverted, className }: { inverted?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-white shadow-sm">
        <CalendarCheck2 className="size-4.5" aria-hidden />
      </span>
      <span className={cn("text-lg font-bold tracking-tight", inverted ? "text-white" : "text-foreground")}>ReserveFlow</span>
    </div>
  );
}
