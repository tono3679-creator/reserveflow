"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BookingDetail, BookingOptions } from "@/lib/data/bookings";
import { isCancelled } from "@/lib/domain/booking";
import { formatInZone } from "@/lib/format";
import { BookingFormDialog } from "./booking-form-dialog";
import { StatusActions } from "./status-actions";

/** 予約詳細の操作：ステータス変更と内容の編集 */
export function BookingDetailActions({
  booking, options, timezone, canManage, canCreateCustomer,
}: { booking: BookingDetail; options: BookingOptions; timezone: string; canManage: boolean; canCreateCustomer: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  return (
    <div className="grid gap-3">
      <StatusActions
        bookingId={booking.id}
        version={booking.version}
        status={booking.status}
        startsAt={booking.startsAt}
        canCancel={canManage}
        onChanged={() => router.refresh()}
      />
      {canManage && !isCancelled(booking.status) && (
        <div>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil aria-hidden />内容を編集</Button>
        </div>
      )}
      {editing && (
        <BookingFormDialog
          open
          onOpenChange={setEditing}
          options={options}
          canCreateCustomer={canCreateCustomer}
          onSaved={() => router.refresh()}
          initial={{
            bookingId: booking.id, version: booking.version,
            customer: { id: booking.customerId, name: booking.customerName, nameKana: null, phone: booking.customerPhone, email: booking.customerEmail },
            serviceId: booking.serviceId, staffId: booking.staffId,
            date: formatInZone(booking.startsAt, timezone, "yyyy-MM-dd"),
            startTime: formatInZone(booking.startsAt, timezone, "HH:mm"),
            endTime: formatInZone(booking.endsAt, timezone, "HH:mm"),
            price: booking.price, notes: booking.notes,
          }}
        />
      )}
    </div>
  );
}
