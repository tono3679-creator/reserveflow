import { SEGMENT_LABELS, SEGMENT_TONE, type Segment } from "@/lib/domain/customer-segment";
import { cn } from "@/lib/utils";

export function SegmentBadge({ segment, className }: { segment: Segment; className?: string }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", SEGMENT_TONE[segment], className)}>
      {SEGMENT_LABELS[segment]}
    </span>
  );
}
