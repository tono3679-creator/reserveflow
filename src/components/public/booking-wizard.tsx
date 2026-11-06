"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, CalendarCheck2, Check, Clock, Copy, Loader2, User } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { Field } from "@/components/common/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatInZone, formatYen } from "@/lib/format";
import { zonedDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { customerInfoSchema, type CustomerInfoInput } from "@/lib/validation/public-booking";
import { DatePicker, TimePicker, type Slot } from "./slot-picker";

export type WizardLocation = {
  slug: string; name: string; timezone: string; staffSelection: "required" | "optional" | "none"; cancellationPolicy: string;
  cancelDeadlineHours: number; phone: string | null;
  services: { id: string; name: string; category: string | null; description: string | null; price: number; durationMinutes: number; staffIds: string[] }[];
  staff: { id: string; name: string; title: string | null; color: string }[];
};

type StepKey = "service" | "staff" | "date" | "time" | "info" | "confirm" | "done";
const STEP_LABELS: Record<StepKey, string> = {
  service: "サービスを選ぶ", staff: "スタッフを選ぶ", date: "日付を選ぶ", time: "時間を選ぶ", info: "お客様情報", confirm: "内容の確認", done: "予約完了",
};

/**
 * お客様の予約の流れ：サービス → スタッフ（任意）→ 日付 → 空き時間 → お客様情報 → 確認 → 確定 → 完了。
 * 空き状況は表示のたびにサーバーから取り、確定のときにサーバーで判定し直す。
 */
export function BookingWizard({ location: loc, today, lastDate }: { location: WizardLocation; today: string; lastDate: string }) {
  const steps: StepKey[] = loc.staffSelection === "none"
    ? ["service", "date", "time", "info", "confirm", "done"]
    : ["service", "staff", "date", "time", "info", "confirm", "done"];
  const [step, setStep] = useState<StepKey>("service");
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState<string | "any">("any");
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [info, setInfo] = useState<z.output<typeof customerInfoSchema> | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ manageUrl: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const service = loc.services.find((s) => s.id === serviceId) ?? null;
  const staffName = staffId === "any" ? null : loc.staff.find((s) => s.id === staffId)?.name ?? null;
  const index = steps.indexOf(step);
  const tz = loc.timezone;

  useEffect(() => {
    headingRef.current?.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  const go = (s: StepKey) => setStep(s);
  const next = () => setStep(steps[index + 1]);
  const back = () => setStep(steps[Math.max(0, index - 1)]);

  const form = useForm<CustomerInfoInput, unknown, z.output<typeof customerInfoSchema>>({
    resolver: zodResolver(customerInfoSchema),
    defaultValues: { name: "", nameKana: "", phone: "", email: "", message: "" },
  });

  const submit = async () => {
    if (!service || !slot || !info) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/${loc.slug}/bookings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serviceId: service.id, staffId: staffId === "any" ? null : staffId, startsAt: slot.start, customer: info, agreed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "予約できませんでした");
        if (res.status === 409) {
          setSlot(null);
          setReloadKey((k) => k + 1);
          go("time");
        }
        return;
      }
      setDone({ manageUrl: body.manageUrl });
      go("done");
    } catch {
      toast.error("通信できませんでした。電波の良いところでもう一度お試しください。");
    } finally {
      setSubmitting(false);
    }
  };

  const when = slot ? `${formatInZone(slot.start, tz, "yyyy年M月d日(E) HH:mm")}〜${formatInZone(slot.end, tz, "HH:mm")}` : null;
  const categories = [...new Set(loc.services.map((s) => s.category ?? "メニュー"))];

  return (
    <div className="grid gap-5">
      {step !== "done" && (
        <nav aria-label="予約の手順">
          <ol className="flex gap-1">
            {steps.slice(0, -1).map((s, i) => (
              <li key={s} className={cn("h-1.5 flex-1 rounded-full", i <= index ? "bg-primary" : "bg-muted")} aria-current={s === step ? "step" : undefined}>
                <span className="sr-only">{STEP_LABELS[s]}{i < index ? "（済み）" : ""}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">ステップ {index + 1} / {steps.length - 1}</p>
        </nav>
      )}
      <div className="flex items-center gap-2">
        {index > 0 && step !== "done" && (
          <Button variant="ghost" size="icon-sm" onClick={back} aria-label="前の手順に戻る"><ArrowLeft /></Button>
        )}
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-bold outline-none">{STEP_LABELS[step]}</h2>
      </div>

      {/* 選んだ内容（あとの手順で表示。押すとその手順に戻る） */}
      {index > 0 && step !== "done" && step !== "confirm" && (
        <dl className="grid gap-1 rounded-lg border bg-muted/40 p-3 text-sm">
          {service && <Summary label="サービス" value={`${service.name}（${service.durationMinutes}分・${formatYen(service.price)}）`} onEdit={() => go("service")} />}
          {loc.staffSelection !== "none" && index > steps.indexOf("staff") && <Summary label="スタッフ" value={staffName ?? "指名なし"} onEdit={() => go("staff")} />}
          {date && index > steps.indexOf("date") && <Summary label="日付" value={formatInZone(zonedDateTime(date, "12:00", tz), tz, "M月d日(E)")} onEdit={() => go("date")} />}
          {slot && index > steps.indexOf("time") && <Summary label="時間" value={formatInZone(slot.start, tz, "HH:mm") + "〜"} onEdit={() => go("time")} />}
        </dl>
      )}

      {step === "service" && (
        <div className="grid gap-5">
          {loc.services.length === 0 && <p className="text-sm text-muted-foreground">現在、Web で予約できるメニューはありません。</p>}
          {categories.map((cat) => (
            <section key={cat} aria-label={cat} className="grid gap-2">
              {categories.length > 1 && <h3 className="text-xs font-semibold text-muted-foreground">{cat}</h3>}
              {loc.services.filter((s) => (s.category ?? "メニュー") === cat).map((s) => (
                <button key={s.id} type="button" aria-pressed={serviceId === s.id}
                  onClick={() => { setServiceId(s.id); if (staffId !== "any" && !s.staffIds.includes(staffId)) setStaffId("any"); setDate(null); setSlot(null); setStep(steps[1]); }}
                  className={cn("grid gap-1 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-ring", serviceId === s.id && "border-primary ring-1 ring-primary")}>
                  <span className="flex items-start justify-between gap-3">
                    <span className="font-semibold">{s.name}</span>
                    <span className="shrink-0 font-semibold tabular">{formatYen(s.price)}</span>
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="size-3.5" aria-hidden />{s.durationMinutes}分</span>
                  {s.description && <span className="text-sm text-muted-foreground">{s.description}</span>}
                </button>
              ))}
            </section>
          ))}
        </div>
      )}

      {step === "staff" && service && (
        <div className="grid gap-2">
          {[{ id: "any", name: "指名なし", title: "空いているスタッフが担当します", color: "#94a3b8" }, ...loc.staff.filter((s) => service.staffIds.includes(s.id))].map((s) => (
            <button key={s.id} type="button" aria-pressed={staffId === s.id}
              onClick={() => { setStaffId(s.id); setDate(null); setSlot(null); next(); }}
              className={cn("flex items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-ring", staffId === s.id && "border-primary ring-1 ring-primary")}>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ backgroundColor: s.color }} aria-hidden>
                {s.id === "any" ? <User className="size-5" /> : s.name.slice(0, 1)}
              </span>
              <span className="grid">
                <span className="font-semibold">{s.name}</span>
                {s.title && <span className="text-xs text-muted-foreground">{s.title}</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      {step === "date" && service && (
        <DatePicker slug={loc.slug} serviceId={service.id} staffId={staffId} timezone={tz} today={today} lastDate={lastDate} value={date}
          onChange={(d) => { setDate(d); setSlot(null); next(); }} />
      )}

      {step === "time" && service && date && (
        <TimePicker slug={loc.slug} serviceId={service.id} staffId={staffId} date={date} timezone={tz} value={slot?.start ?? null} reloadKey={reloadKey}
          onChange={(s) => { setSlot(s); next(); }} />
      )}

      {step === "info" && (
        <form noValidate className="grid gap-4" onSubmit={form.handleSubmit((v) => { setInfo(v); next(); })}>
          <Field label="お名前" htmlFor="pb-name" required error={form.formState.errors.name?.message}>
            <Input id="pb-name" autoComplete="name" aria-invalid={!!form.formState.errors.name} {...form.register("name")} />
          </Field>
          <Field label="ふりがな" htmlFor="pb-kana" error={form.formState.errors.nameKana?.message}>
            <Input id="pb-kana" autoComplete="off" {...form.register("nameKana")} />
          </Field>
          <Field label="電話番号" htmlFor="pb-phone" required error={form.formState.errors.phone?.message}>
            <Input id="pb-phone" type="tel" inputMode="tel" autoComplete="tel" aria-invalid={!!form.formState.errors.phone} {...form.register("phone")} />
          </Field>
          <Field label="メールアドレス" htmlFor="pb-email" required error={form.formState.errors.email?.message} hint="予約の確認と、変更・キャンセル用のリンクをお送りします">
            <Input id="pb-email" type="email" inputMode="email" autoComplete="email" aria-invalid={!!form.formState.errors.email} {...form.register("email")} />
          </Field>
          <Field label="ご要望（任意）" htmlFor="pb-message" error={form.formState.errors.message?.message}>
            <Textarea id="pb-message" rows={3} maxLength={500} {...form.register("message")} />
          </Field>
          <Button type="submit" size="lg" className="w-full">確認へ進む</Button>
        </form>
      )}

      {step === "confirm" && service && slot && info && (
        <div className="grid gap-4">
          <dl className="grid gap-3 rounded-xl border bg-card p-4 text-sm">
            <Row label="日時" value={when!} />
            <Row label="サービス" value={`${service.name}（${service.durationMinutes}分）`} />
            {loc.staffSelection !== "none" && <Row label="スタッフ" value={staffName ?? "指名なし（空いているスタッフが担当）"} />}
            <Row label="料金" value={formatYen(service.price)} />
            <Row label="お名前" value={`${info.name} 様`} />
            <Row label="連絡先" value={`${info.phone}／${info.email}`} />
            {info.message && <Row label="ご要望" value={info.message} />}
          </dl>
          <section className="rounded-xl border bg-warning-soft/60 p-4 text-sm">
            <h3 className="font-semibold">キャンセルポリシー</h3>
            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
              {loc.cancellationPolicy || `変更・キャンセルは開始の${loc.cancelDeadlineHours}時間前まで、予約完了後に表示されるリンクから行えます。`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Web での変更・キャンセルの受付は、開始の{loc.cancelDeadlineHours}時間前までです。</p>
          </section>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-5 accent-primary" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            キャンセルポリシーを確認し、同意します
          </label>
          <Button size="lg" className="w-full" disabled={!agreed || submitting} onClick={submit}>
            {submitting && <Loader2 className="animate-spin" aria-hidden />}この内容で予約を確定する
          </Button>
          <p className="text-center text-xs text-muted-foreground">確定の直前に、空き状況をもう一度確認します。</p>
        </div>
      )}

      {step === "done" && done && service && slot && (
        <div className="grid gap-4 text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-success-soft text-success-strong"><Check className="size-7" aria-hidden /></span>
          <p className="text-keep text-base font-semibold">ご予約を承りました。ご来店をお待ちしております。</p>
          <dl className="grid gap-3 rounded-xl border bg-card p-4 text-left text-sm">
            <Row label="日時" value={when!} />
            <Row label="サービス" value={service.name} />
            <Row label="店舗" value={loc.name} />
          </dl>
          <div className="grid gap-2 rounded-xl border bg-muted/40 p-4 text-left text-sm">
            <p className="font-semibold">予約の確認・変更・キャンセル</p>
            <p className="text-muted-foreground">このリンクはご本人専用です。他の人に知らせないでください（メールでもお送りしています）。</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm"><Link href={done.manageUrl}><CalendarCheck2 aria-hidden />予約を確認する</Link></Button>
              <Button variant="ghost" size="sm" onClick={() => {
                navigator.clipboard?.writeText(new URL(done.manageUrl, window.location.origin).toString())
                  .then(() => toast.success("リンクをコピーしました"), () => toast.error("コピーできませんでした"));
              }}><Copy aria-hidden />リンクをコピー</Button>
            </div>
          </div>
          {loc.phone && <p className="text-xs text-muted-foreground">お問い合わせ：<a className="underline" href={`tel:${loc.phone}`}>{loc.phone}</a></p>}
        </div>
      )}
    </div>
  );
}

function Summary({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="w-16 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 truncate">{value}</dd>
      <dd><button type="button" onClick={onEdit} className="text-xs text-primary underline-offset-2 hover:underline">変更</button></dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5rem_1fr] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap break-words">{value}</dd>
    </div>
  );
}
