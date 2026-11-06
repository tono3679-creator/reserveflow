"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { addCustomerNote, deleteCustomerNote } from "@/lib/actions/customers";
import { formatInZone } from "@/lib/format";

type Note = { id: string; body: string; createdAt: string; author: string | null; mine: boolean };

/** 顧客メモ（来店時の様子・好みなど）。自分のメモはいつでも、マネージャー以上は全員のメモを削除できる */
export function CustomerNotes({ customerId, notes, timezone, canDeleteAny }: { customerId: string; notes: Note[]; timezone: string; canDeleteAny: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState<string | null>(null);

  const add = () =>
    startTransition(async () => {
      const result = await addCustomerNote({ customerId, body });
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.message);
      setBody("");
      router.refresh();
    });
  const remove = (id: string) => {
    setDeleting(id);
    startTransition(async () => {
      const result = await deleteCustomerNote(id, customerId);
      setDeleting(null);
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.message);
      router.refresh();
    });
  };

  return (
    <div className="grid gap-4">
      <form onSubmit={(e) => { e.preventDefault(); if (body.trim()) add(); }} className="grid gap-2">
        <label htmlFor="note-body" className="sr-only">メモ</label>
        <Textarea id="note-body" rows={3} value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} placeholder="例：カラーは明るめが好み。次回はトリートメントを提案。" />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={pending || !body.trim()}>{pending && !deleting && <Loader2 className="animate-spin" aria-hidden />}メモを追加</Button>
        </div>
      </form>
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">メモはまだありません。</p>
      ) : (
        <ul className="grid gap-3">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border bg-muted/40 p-3">
              <p className="whitespace-pre-wrap break-words text-sm">{n.body}</p>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="tabular">{formatInZone(n.createdAt, timezone, "yyyy/MM/dd HH:mm")}・{n.author ?? "（退職したメンバー）"}</span>
                {(n.mine || canDeleteAny) && (
                  <Button variant="ghost" size="icon-sm" aria-label="このメモを削除" disabled={pending} onClick={() => remove(n.id)}>
                    {deleting === n.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
