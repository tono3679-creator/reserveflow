"use client";
import Link from "next/link";
import { CalendarClock, ExternalLink, Pencil, User, X } from "lucide-react";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { CalendarBooking } from "@/lib/data/bookings";
import { isCancelled } from "@/lib/domain/booking";
import { formatInZone, formatYen } from "@/lib/format";
import { StatusActions } from "./status-actions";

/** カレンダーで予約を選んだときの詳細パネル（ステータス変更・編集・詳細画面へ） */
export function BookingSheet({
  booking, timezone, canManage, onClose, onChanged, onEdit,
}: {
  booking: CalendarBooking | null;
  timezone: string;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (b: CalendarBooking) => void;
}) {
  return (
    <Sheet open={!!booking} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[26rem] gap-0 overflow-y-auto bg-card" aria-describedby={undefined}>
        {booking && (
          <>
            <div className="flex items-start justify-between gap-2 border-b p-4">
              <div className="min-w-0">
                <SheetTitle className="text-lg font-semibold">{booking.serviceName}</SheetTitle>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground tabular">
                  <CalendarClock className="size-4" aria-hidden />
                  {formatInZone(booking.startsAt, timezone, "M月d日(E) HH:mm")}〜{formatInZone(booking.endsAt, timezone, "HH:mm")}
                </p>
              </div>
              <SheetClose asChild>
                <Button variant="ghost" size="icon-sm" aria-label="閉じる"><X /></Button>
              </SheetClose>
            </div>
            <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-3 p-4 text-sm">
              <dt className="text-muted-foreground">ステータス</dt>
              <dd><StatusBadge status={booking.status} /></dd>
              <dt className="text-muted-foreground">顧客</dt>
              <dd>
                <Link href={`/customers/${booking.customerId}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                  <User className="size-3.5" aria-hidden />{booking.customerName}
                </Link>
              </dd>
              {booking.staffName && (<><dt className="text-muted-foreground">担当</dt><dd>{booking.staffName}</dd></>)}
              {booking.resourceNames && (<><dt className="text-muted-foreground">設備</dt><dd>{booking.resourceNames}</dd></>)}
              <dt className="text-muted-foreground">料金</dt>
              <dd className="tabular">{formatYen(booking.price)}</dd>
              {booking.notes && (<><dt className="text-muted-foreground">備考</dt><dd className="whitespace-pre-wrap break-words">{booking.notes}</dd></>)}
            </dl>
            <div className="grid gap-3 border-t p-4">
              <p className="text-xs font-medium text-muted-foreground">ステータスを変更</p>
              <StatusActions
                key={booking.id}
                bookingId={booking.id}
                version={booking.version}
                status={booking.status}
                startsAt={booking.startsAt}
                canCancel={canManage}
                onChanged={onChanged}
              />
            </div>
            <div className="mt-auto flex flex-wrap gap-2 border-t p-4">
              {canManage && !isCancelled(booking.status) && (
                <Button variant="outline" size="sm" onClick={() => onEdit(booking)}><Pencil aria-hidden />内容を編集</Button>
              )}
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/bookings/${booking.id}`}><ExternalLink aria-hidden />詳細・変更履歴</Link>
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
