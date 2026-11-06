"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CustomerOption } from "@/lib/actions/customers";
import type { BookingOptions } from "@/lib/data/bookings";
import { BookingFormDialog } from "./booking-form-dialog";

/** 「新規予約」ボタン（一覧・顧客詳細から使う）。登録後は予約の詳細へ移る */
export function NewBookingButton({
  options, today, canCreateCustomer, customer, size = "default", goToDetail = true,
}: {
  options: BookingOptions;
  today: string;
  canCreateCustomer: boolean;
  customer?: CustomerOption;
  size?: "default" | "sm";
  goToDetail?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} onClick={() => setOpen(true)}><Plus aria-hidden />新規予約</Button>
      {open && (
        <BookingFormDialog
          open
          onOpenChange={setOpen}
          options={options}
          initial={{ date: today, startTime: "10:00", customer: customer ?? null, staffId: null }}
          canCreateCustomer={canCreateCustomer}
          onSaved={(id) => (goToDetail ? router.push(`/bookings/${id}`) : router.refresh())}
        />
      )}
    </>
  );
}
