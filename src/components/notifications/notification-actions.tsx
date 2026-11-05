"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Loader2, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { retryNotification, runNotificationsNow } from "@/lib/actions/notifications";

/** 送った（またはデモとして表示した）通知の件名と本文 */
export function NotificationBodyButton({ subject, body, recipient, label }: { subject: string; body: string; recipient: string | null; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`${label}の本文を見る`}><Eye aria-hidden />本文</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">{subject}</DialogTitle>
            <DialogDescription>宛先：{recipient ?? "（なし）"}</DialogDescription>
          </DialogHeader>
          <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-4 font-sans text-sm leading-relaxed">{body}</pre>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RetryButton({ deliveryId }: { deliveryId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={() => start(async () => {
      const r = await retryNotification(deliveryId);
      if (r.ok) toast.success(r.message ?? "再送しました"); else toast.error(r.error);
      router.refresh();
    })}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}再送
    </Button>
  );
}

/** リマインドの対象確認と未送信の処理をすぐに行う（通常は毎日の自動処理） */
export function RunNowButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" disabled={pending} onClick={() => start(async () => {
      const r = await runNotificationsNow();
      if (r.ok) toast.success(r.data.processed > 0 ? `${r.data.processed}件の通知を処理しました` : "処理する通知はありませんでした");
      else toast.error(r.error);
      router.refresh();
    })}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}今すぐ処理する
    </Button>
  );
}
