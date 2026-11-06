"use client";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/common/form-field";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { changeBookingStatus } from "@/lib/actions/bookings";
import { isCancelled, nextStatuses, STATUS_LABELS, type BookingStatus } from "@/lib/domain/booking";

const ACTION_LABELS: Partial<Record<BookingStatus, string>> = {
  checked_in: "来店済みにする",
  completed: "サービス完了にする",
  no_show: "無断キャンセルにする",
  cancelled_customer: "顧客都合でキャンセル",
  cancelled_store: "店舗都合でキャンセル",
};

/** ステータス変更のボタン。キャンセル・無断キャンセルは確認を挟む */
export function StatusActions({
  bookingId, version, status, startsAt, canCancel, onChanged,
}: { bookingId: string; version: number; status: BookingStatus; startsAt: string; canCancel: boolean; onChanged?: () => void }) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<BookingStatus | null>(null);
  const [reason, setReason] = useState("");
  const choices = nextStatuses(status, { canCancel, startsAt: new Date(startsAt) });

  const run = (to: BookingStatus) =>
    startTransition(async () => {
      const result = await changeBookingStatus({ bookingId, version, status: to, reason });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`「${STATUS_LABELS[to]}」に変更しました`);
      setConfirm(null);
      setReason("");
      onChanged?.();
    });

  if (choices.length === 0) return <p className="text-xs text-muted-foreground">この予約のステータスは変更できません。</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {choices.map((s) => {
        const destructive = isCancelled(s) || s === "no_show";
        const label = ACTION_LABELS[s] ?? (isCancelled(status) ? "予約確定に戻す" : `「${STATUS_LABELS[s]}」に戻す`);
        return (
          <Button
            key={s}
            size="sm"
            variant={destructive ? "outline" : s === "completed" ? "success" : "secondary"}
            className={destructive ? "text-destructive hover:text-destructive" : undefined}
            disabled={pending}
            onClick={() => (destructive ? setConfirm(s) : run(s))}
          >
            {pending && !confirm && <Loader2 className="animate-spin" aria-hidden />}
            {label}
          </Button>
        );
      })}
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm && (ACTION_LABELS[confirm] ?? "")}しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "no_show"
                ? "連絡なしで来店されなかった予約として記録します。無断キャンセル率の集計に含まれます。"
                : "予約の枠が空き、ほかの予約を入れられるようになります。キャンセルの通知が作られます。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field label="理由（任意）" htmlFor="status-reason">
            <Textarea id="status-reason" rows={2} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>やめる</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={pending}
              onClick={(e) => { e.preventDefault(); if (confirm) run(confirm); }}
            >
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {confirm && (ACTION_LABELS[confirm] ?? "")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
