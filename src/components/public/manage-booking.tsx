"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, Lock, XCircle } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { BookingStatus } from "@/lib/domain/booking";
import { formatInZone, formatYen } from "@/lib/format";
import { DatePicker, TimePicker, type Slot } from "./slot-picker";

type Booking = {
  id: string; status: BookingStatus; startsAt: string; endsAt: string; serviceId: string; serviceName: string;
  staffId: string | null; staffName: string | null; price: number; customerName: string; customerMessage: string | null;
  canChange: boolean; changeDeadline: string; reasonIfLocked: string | null;
};
type Loc = {
  slug: string; timezone: string; staffSelection: "required" | "optional" | "none"; cancellationPolicy: string;
  cancelDeadlineHours: number; phone: string | null; staff: { id: string; name: string; title: string | null }[];
};

/** お客様が自分の予約を確認・日時変更・キャンセルする画面（確定はサーバーで期限と空きを再確認） */
export function ManageBooking({ token, booking: b, location: loc, today, lastDate }: {
  token: string; booking: Booking; location: Loc; today: string; lastDate: string;
}) {
  const router = useRouter();
  const tz = loc.timezone;
  const [mode, setMode] = useState<"view" | "reschedule" | "cancel">("view");
  const [staffId, setStaffId] = useState<string | "any">(loc.staffSelection === "none" ? "any" : (b.staffId ?? "any"));
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const post = async (body: object, success: string) => {
    setSending(true);
    try {
      const res = await fetch(`/api/public/${loc.slug}/manage/${token}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "受け付けられませんでした");
        if (res.status === 409) { setSlot(null); setReloadKey((k) => k + 1); }
        return;
      }
      toast.success(success);
      setMode("view");
      setDate(null);
      setSlot(null);
      router.refresh();
    } catch {
      toast.error("通信できませんでした。もう一度お試しください。");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-lg font-bold">ご予約の確認</h1>
        <p className="mt-1 text-sm text-muted-foreground">{b.customerName} 様のご予約です。</p>
      </div>
      <dl className="grid gap-3 rounded-xl border bg-card p-4 text-sm">
        <Row label="状態"><StatusBadge status={b.status} /></Row>
        <Row label="日時">{formatInZone(b.startsAt, tz, "yyyy年M月d日(E) HH:mm")}〜{formatInZone(b.endsAt, tz, "HH:mm")}</Row>
        <Row label="サービス">{b.serviceName}</Row>
        {loc.staffSelection !== "none" && <Row label="スタッフ">{b.staffName ?? "指名なし"}</Row>}
        <Row label="料金">{formatYen(b.price)}</Row>
        {b.customerMessage && <Row label="ご要望">{b.customerMessage}</Row>}
      </dl>

      {!b.canChange ? (
        <p className="flex items-start gap-2 rounded-xl border bg-muted/40 p-4 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>{b.reasonIfLocked}{loc.phone && <> 電話：<a className="underline" href={`tel:${loc.phone}`}>{loc.phone}</a></>}</span>
        </p>
      ) : mode === "view" ? (
        <div className="grid gap-3">
          <p className="text-xs text-muted-foreground">
            変更・キャンセルは {formatInZone(b.changeDeadline, tz, "M月d日(E) HH:mm")} まで受け付けています。
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button size="lg" variant="outline" onClick={() => setMode("reschedule")}><CalendarClock aria-hidden />日時を変更する</Button>
            <Button size="lg" variant="outline" className="text-destructive" onClick={() => setMode("cancel")}><XCircle aria-hidden />キャンセルする</Button>
          </div>
        </div>
      ) : mode === "reschedule" ? (
        <section className="grid gap-4 rounded-xl border bg-card p-4" aria-label="日時の変更">
          <h2 className="font-semibold">新しい日時を選んでください</h2>
          {loc.staffSelection !== "none" && loc.staff.length > 0 && (
            <div className="grid gap-1.5">
              <Label htmlFor="mb-staff">スタッフ</Label>
              <NativeSelect id="mb-staff" value={staffId} onChange={(e) => { setStaffId(e.target.value); setDate(null); setSlot(null); }}>
                <option value="any">指名なし</option>
                {loc.staff.map((s) => <option key={s.id} value={s.id}>{s.name}{s.title ? `（${s.title}）` : ""}</option>)}
              </NativeSelect>
            </div>
          )}
          <DatePicker slug={loc.slug} serviceId={b.serviceId} staffId={staffId} timezone={tz} today={today} lastDate={lastDate} manage={token}
            value={date} onChange={(d) => { setDate(d); setSlot(null); }} />
          {date && (
            <TimePicker slug={loc.slug} serviceId={b.serviceId} staffId={staffId} date={date} timezone={tz} manage={token}
              value={slot?.start ?? null} reloadKey={reloadKey} onChange={setSlot} />
          )}
          {slot && (
            <p className="rounded-lg bg-muted/50 p-3 text-sm">
              変更後：<strong className="tabular">{formatInZone(slot.start, tz, "M月d日(E) HH:mm")}〜{formatInZone(slot.end, tz, "HH:mm")}</strong>
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => { setMode("view"); setDate(null); setSlot(null); }}>やめる</Button>
            <Button disabled={!slot || sending}
              onClick={() => slot && post({ action: "reschedule", startsAt: slot.start, staffId: staffId === "any" ? null : staffId }, "日時を変更しました")}>
              {sending && <Loader2 className="animate-spin" aria-hidden />}この日時に変更する
            </Button>
          </div>
        </section>
      ) : (
        <section className="grid gap-4 rounded-xl border border-destructive/40 bg-card p-4" aria-label="キャンセル">
          <h2 className="font-semibold">この予約をキャンセルしますか？</h2>
          {loc.cancellationPolicy && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{loc.cancellationPolicy}</p>}
          <div className="grid gap-1.5">
            <Label htmlFor="mb-reason">理由（任意）</Label>
            <Textarea id="mb-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setMode("view")}>戻る</Button>
            <Button variant="destructive" disabled={sending} onClick={() => post({ action: "cancel", reason }, "予約をキャンセルしました")}>
              {sending && <Loader2 className="animate-spin" aria-hidden />}キャンセルを確定する
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}
