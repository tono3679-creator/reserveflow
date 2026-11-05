import { STATUS_LABELS, STATUS_TONE, type BookingStatus } from "@/lib/domain/booking";
import { cn } from "@/lib/utils";

const TONE_CLASS = {
  info: "bg-info-soft text-info-strong ring-info-strong/20",
  brand: "bg-accent text-accent-foreground ring-primary/20",
  success: "bg-success-soft text-success-strong ring-success-strong/20",
  muted: "bg-muted text-muted-foreground ring-border",
  warning: "bg-warning-soft text-warning-strong ring-warning-strong/20",
  danger: "bg-danger-soft text-danger-strong ring-danger-strong/20",
} as const;

export function StatusBadge({ status, className }: { status: BookingStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONE_CLASS[STATUS_TONE[status]], className)}>
      {STATUS_LABELS[status]}
    </span>
  );
}
