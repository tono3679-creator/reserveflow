"use client";
import { useEffect, useMemo, useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { fetchCalendarBookings, fetchStaffDay, type StaffDayInfo } from "@/lib/actions/calendar";
import type { CalendarBooking } from "@/lib/data/bookings";
import { isCancelled, STATUS_LABELS } from "@/lib/domain/booking";
import { addDays, fromMinutes, localMinutes, toMinutes, zonedDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

const PX_PER_MIN = 1.1;
const SNAP = 15;
const UNASSIGNED = "__none__";

type MovePayload = { bookingId: string; version: number; startsAt: string; endsAt: string; staffId?: string | null; confirmWarnings: boolean };

type Column = { id: string; name: string; color: string; title: string | null; working: { start: string; end: string }[]; breaks: { start: string; end: string }[]; dayOff: boolean };

/**
 * スタッフ別の日表示。縦が時刻、横がスタッフ。勤務時間外・休憩は網かけで示す。
 * 空いているところを押すと新規予約、予約をドラッグすると別のスタッフ・時刻へ移動できる（確定はサーバーで再判定）。
 */
export function StaffDayView({
  date, timezone, includeCancelled, canManage, onSelect, onCreate, onMove,
}: {
  date: string;
  timezone: string;
  includeCancelled: boolean;
  canManage: boolean;
  onSelect: (b: CalendarBooking) => void;
  onCreate: (time: string, staffId: string | null) => void;
  onMove: (payload: MovePayload, revert: () => void) => void;
}) {
  const [day, setDay] = useState<StaffDayInfo | null>(null);
  const [bookings, setBookings] = useState<CalendarBooking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // ドラッグした予約をサーバーの確定前に仮の位置へ動かす（失敗したら元に戻す）
  const [optimistic, setOptimistic] = useState<Record<string, { start: number; end: number; staffId: string | null }>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [d, b] = await Promise.all([
        fetchStaffDay(date),
        fetchCalendarBookings({
          start: zonedDateTime(date, "00:00", timezone).toISOString(),
          end: zonedDateTime(addDays(date, 1), "00:00", timezone).toISOString(),
          includeCancelled,
        }),
      ]);
      if (cancelled) return;
      if (!d.ok) return setError(d.error);
      if (!b.ok) return setError(b.error);
      setDay(d.data);
      setBookings(b.data);
    })();
    return () => { cancelled = true; };
  }, [date, timezone, includeCancelled]);

  const { from, to } = useMemo(() => {
    const times = [
      ...(day?.open ?? []).flatMap((w) => [toMinutes(w.start), toMinutes(w.end)]),
      ...(day?.staff ?? []).flatMap((s) => s.working.flatMap((w) => [toMinutes(w.start), toMinutes(w.end)])),
      ...bookings.flatMap((b) => [localMinutes(new Date(b.startsAt), timezone), localMinutes(new Date(b.endsAt), timezone) || 24 * 60]),
    ];
    if (times.length === 0) return { from: 9 * 60, to: 19 * 60 };
    return { from: Math.floor(Math.min(...times) / 60) * 60, to: Math.min(24 * 60, Math.ceil(Math.max(...times) / 60) * 60) };
  }, [day, bookings, timezone]);

  if (error) {
    return (
      <div role="alert" className="flex items-center gap-2 rounded-xl border bg-card p-6 text-sm">
        <TriangleAlert className="size-4 text-destructive" aria-hidden />スタッフ別の予定を読み込めませんでした：{error}
      </div>
    );
  }
  if (!day) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />読み込み中…
      </div>
    );
  }

  const columns: Column[] = [...day.staff];
  if (bookings.some((b) => b.staffId === null)) {
    columns.push({ id: UNASSIGNED, name: "担当なし", color: "#64748b", title: null, working: day.open, breaks: [], dayOff: false });
  }
  if (columns.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        この店舗にはスタッフが登録されていないため、スタッフ別の表示はありません。週・日の表示を使ってください。
      </div>
    );
  }

  const height = (to - from) * PX_PER_MIN;
  const top = (min: number) => (min - from) * PX_PER_MIN;
  const hours = Array.from({ length: (to - from) / 60 + 1 }, (_, i) => from + i * 60);
  const minuteAt = (e: React.MouseEvent | React.DragEvent, el: HTMLElement, offset = 0) => {
    const y = e.clientY - el.getBoundingClientRect().top - offset;
    const raw = from + y / PX_PER_MIN;
    return Math.max(from, Math.min(to - SNAP, Math.round(raw / SNAP) * SNAP));
  };
  const placed = (b: CalendarBooking) => optimistic[b.id] ?? {
    start: localMinutes(new Date(b.startsAt), timezone),
    end: localMinutes(new Date(b.endsAt), timezone) || 24 * 60,
    staffId: b.staffId,
  };

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <div className="grid min-w-max" style={{ gridTemplateColumns: `3.5rem repeat(${columns.length}, minmax(9rem, 1fr))` }}>
        <div className="sticky left-0 z-10 border-b bg-card" />
        {columns.map((c) => (
          <div key={c.id} className="flex items-center gap-2 border-b border-l px-2 py-2 text-sm">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} aria-hidden />
            <span className="truncate font-medium">{c.name}</span>
            {c.dayOff && <span className="ml-auto shrink-0 text-xs text-muted-foreground">休み</span>}
          </div>
        ))}

        <div className="sticky left-0 z-10 bg-card" style={{ height }}>
          {hours.map((h) => (
            <div key={h} className="absolute right-1 -translate-y-1/2 text-[11px] text-muted-foreground tabular" style={{ top: top(h) + 0 }}>
              {h < to || h === from ? fromMinutes(h) : ""}
            </div>
          ))}
        </div>
        {columns.map((c) => {
          const staffId = c.id === UNASSIGNED ? null : c.id;
          const colBookings = bookings.filter((b) => (placed(b).staffId ?? UNASSIGNED) === c.id);
          return (
            <div
              key={c.id}
              className={cn("relative border-l", canManage && "cursor-cell", dragOver === c.id && "bg-accent/60")}
              style={{ height }}
              onClick={(e) => {
                if (!canManage || e.target !== e.currentTarget) return;
                onCreate(fromMinutes(minuteAt(e, e.currentTarget)), staffId);
              }}
              onDragOver={(e) => { if (canManage) { e.preventDefault(); setDragOver(c.id); } }}
              onDragLeave={() => setDragOver((v) => (v === c.id ? null : v))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const data = e.dataTransfer.getData("application/x-rf-booking");
                if (!data) return;
                const { id, offset } = JSON.parse(data) as { id: string; offset: number };
                const b = bookings.find((x) => x.id === id);
                if (!b) return;
                const cur = placed(b);
                const start = minuteAt(e, e.currentTarget, offset);
                const end = start + (cur.end - cur.start);
                if (start === cur.start && staffId === cur.staffId) return;
                setOptimistic((o) => ({ ...o, [id]: { start, end, staffId } }));
                const revert = () => setOptimistic((o) => { const n = { ...o }; delete n[id]; return n; });
                onMove({
                  bookingId: b.id, version: b.version,
                  startsAt: zonedDateTime(date, fromMinutes(start), timezone).toISOString(),
                  endsAt: zonedDateTime(date, fromMinutes(Math.min(end, 23 * 60 + 59)), timezone).toISOString(),
                  staffId: staffId === b.staffId ? undefined : staffId,
                  confirmWarnings: false,
                }, revert);
              }}
            >
              {/* 時刻の線 */}
              {hours.map((h) => <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-border/60" style={{ top: top(h) }} aria-hidden />)}
              {/* 勤務時間外（網かけ）: 勤務の外側を塗る */}
              {offRanges(c, from, to).map((r) => (
                <div key={`off-${r.start}`} className="rf-offhours pointer-events-none absolute inset-x-0" style={{ top: top(r.start), height: (r.end - r.start) * PX_PER_MIN }} aria-hidden />
              ))}
              {c.breaks.map((r) => (
                <div key={`brk-${r.start}`} className="rf-offhours pointer-events-none absolute inset-x-0 flex items-start justify-center pt-0.5 text-[10px] text-muted-foreground"
                  style={{ top: top(toMinutes(r.start)), height: (toMinutes(r.end) - toMinutes(r.start)) * PX_PER_MIN }}>休憩</div>
              ))}
              {colBookings.map((b) => {
                const p = placed(b);
                const dim = isCancelled(b.status) || b.status === "no_show";
                const draggable = canManage && !dim;
                return (
                  <button
                    key={b.id}
                    type="button"
                    draggable={draggable}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("application/x-rf-booking", JSON.stringify({ id: b.id, offset: e.clientY - e.currentTarget.getBoundingClientRect().top }));
                    }}
                    onClick={() => onSelect(b)}
                    className={cn(
                      "absolute inset-x-1 flex flex-col justify-start overflow-hidden rounded-md px-1.5 py-1 text-left text-[11px] leading-tight text-white shadow-sm ring-1 ring-black/10 focus-visible:outline-2 focus-visible:outline-ring",
                      draggable && "cursor-grab active:cursor-grabbing",
                      dim && "rf-event-cancelled",
                      b.status === "completed" && "rf-event-done",
                    )}
                    style={{ top: top(p.start) + 1, height: Math.max(18, (p.end - p.start) * PX_PER_MIN - 2), backgroundColor: b.color }}
                    aria-label={`${fromMinutes(p.start)}〜${fromMinutes(p.end)} ${b.customerName} ${b.serviceName} ${STATUS_LABELS[b.status]}`}
                  >
                    <span className="block font-semibold tabular">{fromMinutes(p.start)}–{fromMinutes(p.end)}{b.status !== "confirmed" && b.status !== "completed" && `［${STATUS_LABELS[b.status]}］`}</span>
                    <span className="block truncate">{b.customerName}</span>
                    <span className="block truncate opacity-90">{b.serviceName}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 勤務していない時間帯（表示範囲のうち、勤務時間の外側） */
function offRanges(c: Column, from: number, to: number): { start: number; end: number }[] {
  if (c.dayOff || c.working.length === 0) return [{ start: from, end: to }];
  const work = c.working.map((w) => ({ start: toMinutes(w.start), end: toMinutes(w.end) })).sort((a, b) => a.start - b.start);
  // 休憩で分かれた勤務は休憩側で表示するので、勤務の最初〜最後の外側だけを塗る
  const first = work[0].start;
  const last = work[work.length - 1].end;
  const out: { start: number; end: number }[] = [];
  if (first > from) out.push({ start: from, end: first });
  if (last < to) out.push({ start: last, end: to });
  return out;
}
