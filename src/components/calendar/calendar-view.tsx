"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import jaLocale from "@fullcalendar/core/locales/ja";
import type { DatesSetArg, EventClickArg, EventDropArg, EventInput, EventSourceFuncArg } from "@fullcalendar/core";
import type { DateClickArg, EventResizeDoneArg } from "@fullcalendar/interaction";
import { ChevronLeft, ChevronRight, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { BookingFormDialog, type BookingFormInitial } from "@/components/bookings/booking-form-dialog";
import { BookingSheet } from "@/components/bookings/booking-sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { moveBooking } from "@/lib/actions/bookings";
import { fetchCalendarBookings } from "@/lib/actions/calendar";
import type { BookingOptions, CalendarBooking } from "@/lib/data/bookings";
import { isCancelled, STATUS_LABELS } from "@/lib/domain/booking";
import { formatInZone } from "@/lib/format";
import { zonedDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { StaffDayView } from "./staff-day-view";

export type ViewKey = "dayGridMonth" | "timeGridWeek" | "timeGridDay" | "staff";
const VIEWS: { key: ViewKey; label: string }[] = [
  { key: "dayGridMonth", label: "月" },
  { key: "timeGridWeek", label: "週" },
  { key: "timeGridDay", label: "日" },
  { key: "staff", label: "スタッフ別" },
];

/**
 * FullCalendar は店舗のタイムゾーンを直接扱えないため、「UTC として表示した現地時刻（壁時計の時刻）」でやり取りする。
 * 予約の時刻（UTC）→ 店舗の現地時刻の文字列 → カレンダー、カレンダーの時刻 → 店舗の現地時刻 → UTC。
 */
function toWall(at: Date | string, tz: string): string {
  return formatInZone(at, tz, "yyyy-MM-dd'T'HH:mm:ss");
}
function fromWall(d: Date, tz: string): Date {
  const iso = d.toISOString();
  return zonedDateTime(iso.slice(0, 10), iso.slice(11, 16), tz);
}
function wallParts(d: Date) {
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

type MovePayload = { bookingId: string; version: number; startsAt: string; endsAt: string; staffId?: string | null; confirmWarnings: boolean };
type PendingMove = { payload: MovePayload; warnings: string[]; revert: () => void };

export function CalendarView({
  timezone, options, canManage, canCreateCustomer, slotMin, slotMax, today, initialDate, initialView = "timeGridWeek",
}: {
  timezone: string;
  options: BookingOptions;
  canManage: boolean;
  canCreateCustomer: boolean;
  slotMin: string;
  slotMax: string;
  today: string;
  /** 最初に表示する日・表示モード（空き枠提案の「カレンダーで見る」から） */
  initialDate?: string;
  initialView?: ViewKey;
}) {
  const router = useRouter();
  const calendarRef = useRef<FullCalendar>(null);
  const [view, setView] = useState<ViewKey>(initialView);
  const [title, setTitle] = useState("");
  const [staffDate, setStaffDate] = useState(initialDate ?? today);
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [staffFilter, setStaffFilter] = useState("");
  const [selected, setSelected] = useState<CalendarBooking | null>(null);
  const [form, setForm] = useState<BookingFormInitial | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [moving, startMove] = useTransition();
  const [reloadKey, setReloadKey] = useState(0);
  const filters = useRef({ includeCancelled, staffFilter });

  // スマートフォンでは日表示から始める
  useEffect(() => {
    // 表示の状態は datesSet で合わせる
    if (window.matchMedia("(max-width: 767px)").matches) calendarRef.current?.getApi().changeView("timeGridDay");
  }, []);

  const reload = useCallback(() => {
    calendarRef.current?.getApi().refetchEvents();
    setReloadKey((k) => k + 1);
    router.refresh();
  }, [router]);

  useEffect(() => {
    filters.current = { includeCancelled, staffFilter };
    calendarRef.current?.getApi().refetchEvents();
  }, [includeCancelled, staffFilter]);

  const loadEvents = useCallback(async (info: EventSourceFuncArg, success: (events: EventInput[]) => void, failure: (e: Error) => void) => {
    const result = await fetchCalendarBookings({
      start: fromWall(info.start, timezone).toISOString(),
      end: fromWall(info.end, timezone).toISOString(),
      includeCancelled: filters.current.includeCancelled,
    });
    if (!result.ok) {
      toast.error(result.error);
      failure(new Error(result.error));
      return;
    }
    success(result.data
      .filter((b) => !filters.current.staffFilter || b.staffId === filters.current.staffFilter)
      .map((b) => ({
        id: b.id,
        title: `${b.customerName}｜${b.serviceName}`,
        start: toWall(b.startsAt, timezone),
        end: toWall(b.endsAt, timezone),
        backgroundColor: b.color,
        borderColor: b.color,
        editable: canManage && !isCancelled(b.status) && b.status !== "no_show",
        classNames: [isCancelled(b.status) || b.status === "no_show" ? "rf-event-cancelled" : "", b.status === "completed" ? "rf-event-done" : ""],
        extendedProps: { booking: b },
      })));
  }, [timezone, canManage]);

  const submitMove = (payload: PendingMove["payload"], revert: () => void) =>
    startMove(async () => {
      const result = await moveBooking(payload);
      if (!result.ok) {
        if (result.warnings) {
          setPendingMove({ payload, warnings: result.warnings, revert });
          return;
        }
        toast.error(result.error);
        revert();
        return;
      }
      setPendingMove(null);
      toast.success(result.message);
      reload();
    });

  const onDrop = (info: EventDropArg | EventResizeDoneArg) => {
    const b = info.event.extendedProps.booking as CalendarBooking;
    if (!info.event.start || !info.event.end) return info.revert();
    submitMove({
      bookingId: b.id, version: b.version,
      startsAt: fromWall(info.event.start, timezone).toISOString(),
      endsAt: fromWall(info.event.end, timezone).toISOString(),
      confirmWarnings: false,
    }, info.revert);
  };

  const openNew = (date: string, start: string, end?: string, staffId?: string | null) => {
    if (!canManage) return;
    setForm({ date, startTime: start, endTime: end, staffId: staffId ?? (staffFilter || null) });
  };

  const changeView = (key: ViewKey) => {
    setView(key);
    if (key !== "staff") calendarRef.current?.getApi().changeView(key);
  };
  const navigate = (dir: -1 | 0 | 1) => {
    if (view === "staff") {
      if (dir === 0) setStaffDate(today);
      else {
        const d = new Date(`${staffDate}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + dir);
        setStaffDate(d.toISOString().slice(0, 10));
      }
      return;
    }
    const api = calendarRef.current?.getApi();
    if (dir === 0) api?.today();
    else if (dir < 0) api?.prev();
    else api?.next();
  };

  const staffTitle = useMemo(() => formatInZone(zonedDateTime(staffDate, "12:00", timezone), timezone, "yyyy年M月d日(E)"), [staffDate, timezone]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" onClick={() => navigate(-1)} aria-label="前へ"><ChevronLeft /></Button>
          <Button variant="outline" size="sm" onClick={() => navigate(0)}>今日</Button>
          <Button variant="outline" size="icon-sm" onClick={() => navigate(1)} aria-label="次へ"><ChevronRight /></Button>
        </div>
        <h2 className="min-w-0 text-base font-semibold tabular sm:text-lg" aria-live="polite">{view === "staff" ? staffTitle : title}</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="表示の切り替え" className="flex rounded-lg border bg-muted p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                role="tab"
                aria-selected={view === v.key}
                onClick={() => changeView(v.key)}
                className={cn("rounded-md px-3 py-1 text-sm font-medium transition-colors", view === v.key ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {v.label}
              </button>
            ))}
          </div>
          {canManage && (
            <Button size="sm" onClick={() => openNew(view === "staff" ? staffDate : today, "10:00")}>
              <Plus aria-hidden />新規予約
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {view !== "staff" && options.staff.length > 0 && (
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">スタッフ</span>
            <NativeSelect className="h-8 w-40" value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)} aria-label="スタッフで絞り込む">
              <option value="">全員</option>
              {options.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </NativeSelect>
          </label>
        )}
        <label className="flex items-center gap-2">
          <Switch checked={includeCancelled} onCheckedChange={setIncludeCancelled} aria-label="キャンセル・無断キャンセルも表示" />
          <span className="text-muted-foreground">キャンセル・無断キャンセルも表示</span>
        </label>
        {canManage && <span className="text-xs text-muted-foreground">空いている時間をドラッグして新規予約／予約をドラッグして日時を変更</span>}
      </div>

      <div className={cn("rf-calendar rounded-xl border bg-card p-2 sm:p-3", view === "staff" && "hidden")}>
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView={initialView === "staff" ? "timeGridDay" : initialView}
          initialDate={initialDate}
          locale={jaLocale}
          timeZone="UTC"
          now={() => toWall(new Date(), timezone)}
          headerToolbar={false}
          height="auto"
          allDaySlot={false}
          slotMinTime={slotMin}
          slotMaxTime={slotMax}
          slotDuration="00:30:00"
          snapDuration="00:15:00"
          nowIndicator
          dayMaxEvents={4}
          editable={canManage}
          selectable={canManage}
          selectMirror
          eventDurationEditable={canManage}
          events={loadEvents}
          datesSet={(arg: DatesSetArg) => {
            setTitle(arg.view.title);
            setView((v) => (v === "staff" ? v : (arg.view.type as ViewKey)));
          }}
          eventClick={(arg: EventClickArg) => setSelected(arg.event.extendedProps.booking as CalendarBooking)}
          eventDrop={onDrop}
          eventResize={onDrop}
          select={(arg) => {
            const s = wallParts(arg.start);
            const e = wallParts(arg.end);
            if (arg.view.type === "dayGridMonth") openNew(s.date, "10:00");
            else openNew(s.date, s.time, e.date === s.date ? e.time : undefined);
            calendarRef.current?.getApi().unselect();
          }}
          dateClick={(arg: DateClickArg) => {
            if (arg.view.type === "dayGridMonth") openNew(wallParts(arg.date).date, "10:00");
          }}
          eventContent={(arg) => {
            const b = arg.event.extendedProps.booking as CalendarBooking;
            return (
              <div className="overflow-hidden px-1 py-0.5 text-[11px] leading-tight">
                <div className="font-semibold tabular">{arg.timeText}{b.status !== "confirmed" && b.status !== "completed" && <span className="ml-1 font-normal">［{STATUS_LABELS[b.status]}］</span>}</div>
                <div className="truncate">{b.customerName}</div>
                <div className="truncate opacity-90">{b.serviceName}{b.staffName ? `・${b.staffName}` : b.resourceNames ? `・${b.resourceNames}` : ""}</div>
              </div>
            );
          }}
        />
      </div>
      {view === "staff" && (
        <StaffDayView
          key={`${staffDate}-${reloadKey}-${includeCancelled}`}
          date={staffDate}
          timezone={timezone}
          includeCancelled={includeCancelled}
          canManage={canManage}
          onSelect={setSelected}
          onCreate={(time, staffId) => openNew(staffDate, time, undefined, staffId)}
          onMove={(payload, revert) => submitMove(payload, revert)}
        />
      )}

      <BookingSheet
        booking={selected}
        timezone={timezone}
        canManage={canManage}
        onClose={() => setSelected(null)}
        onChanged={() => { setSelected(null); reload(); }}
        onEdit={(b) => {
          setSelected(null);
          setForm({
            bookingId: b.id, version: b.version, customer: { id: b.customerId, name: b.customerName, nameKana: null, phone: null, email: null },
            serviceId: b.serviceId, staffId: b.staffId, date: formatInZone(b.startsAt, timezone, "yyyy-MM-dd"),
            startTime: formatInZone(b.startsAt, timezone, "HH:mm"), endTime: formatInZone(b.endsAt, timezone, "HH:mm"), price: b.price, notes: b.notes,
          });
        }}
      />
      {form && (
        <BookingFormDialog
          key={`${form.bookingId ?? "new"}-${form.date}-${form.startTime}-${form.staffId ?? ""}`}
          open
          onOpenChange={(o) => !o && setForm(null)}
          options={options}
          initial={form}
          canCreateCustomer={canCreateCustomer}
          onSaved={() => reload()}
        />
      )}
      <AlertDialog open={!!pendingMove} onOpenChange={(o) => { if (!o && pendingMove) { pendingMove.revert(); setPendingMove(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><TriangleAlert className="size-5 text-warning" aria-hidden />確認してください</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="grid gap-2">
                <ul className="list-disc pl-5 text-sm text-foreground">{pendingMove?.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                <p>このまま変更してもよろしいですか？</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={moving}>元に戻す</AlertDialogCancel>
            <AlertDialogAction disabled={moving} onClick={(e) => { e.preventDefault(); if (pendingMove) submitMove({ ...pendingMove.payload, confirmWarnings: true }, pendingMove.revert); }}>
              このまま変更する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
