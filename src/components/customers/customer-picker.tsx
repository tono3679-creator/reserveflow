"use client";
import { useEffect, useId, useState, useTransition } from "react";
import { Loader2, Search, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createCustomer, searchCustomers, type CustomerOption } from "@/lib/actions/customers";
import { cn } from "@/lib/utils";

/**
 * 顧客の選択（氏名・カナ・電話・メールで検索）。見つからなければその場で登録できる。
 */
export function CustomerPicker({
  value, onChange, invalid, canCreate,
}: { value: CustomerOption | null; onChange: (c: CustomerOption | null) => void; invalid?: boolean; canCreate: boolean }) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerOption[]>([]);
  const [searching, startSearch] = useTransition();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", phone: "", email: "" });
  const [saving, startSave] = useTransition();

  useEffect(() => {
    if (value) return;
    const timer = setTimeout(() => {
      startSearch(async () => {
        const result = await searchCustomers(query);
        if (result.ok) setResults(result.data);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, value]);

  if (value) {
    return (
      <div className={cn("flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2", invalid && "border-destructive")}>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{value.name}</div>
          <div className="truncate text-xs text-muted-foreground">{[value.phone, value.email].filter(Boolean).join("・") || "連絡先未登録"}</div>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => onChange(null)} aria-label="顧客の選択を解除"><X /></Button>
      </div>
    );
  }

  if (creating) {
    const save = () =>
      startSave(async () => {
        const result = await createCustomer({ name: draft.name, nameKana: "", phone: draft.phone, email: draft.email, preferredStaffId: "" });
        if (!result.ok) {
          toast.error(Object.values(result.fieldErrors ?? {})[0] ?? result.error);
          return;
        }
        toast.success(result.message);
        onChange(result.data);
        setCreating(false);
      });
    return (
      <div className="grid gap-2 rounded-md border bg-muted/40 p-3">
        <p className="text-xs font-medium text-muted-foreground">新しい顧客を登録</p>
        <Input placeholder="氏名（必須）" aria-label="新しい顧客の氏名" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <div className="grid gap-2 sm:grid-cols-2">
          <Input placeholder="電話番号" type="tel" aria-label="新しい顧客の電話番号" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
          <Input placeholder="メールアドレス" type="email" aria-label="新しい顧客のメールアドレス" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)}>やめる</Button>
          <Button type="button" size="sm" onClick={save} disabled={saving || !draft.name.trim()}>
            {saving && <Loader2 className="animate-spin" aria-hidden />}登録して選ぶ
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-label="顧客を検索"
          aria-invalid={invalid}
          placeholder="氏名・フリガナ・電話番号で検索"
          className="pl-8"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searching && <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
      </div>
      <ul id={listId} role="listbox" aria-label="顧客の候補" className="max-h-44 overflow-y-auto rounded-md border bg-card">
        {results.length === 0 && !searching && <li className="px-3 py-2 text-sm text-muted-foreground">該当する顧客がいません</li>}
        {results.map((c) => (
          <li key={c.id} role="option" aria-selected={false}>
            <button type="button" onClick={() => onChange(c)} className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
              <span className="text-sm">{c.name}{c.nameKana && <span className="ml-1.5 text-xs text-muted-foreground">{c.nameKana}</span>}</span>
              <span className="text-xs text-muted-foreground">{c.phone ?? c.email ?? ""}</span>
            </button>
          </li>
        ))}
      </ul>
      {canCreate && (
        <Button type="button" variant="link" size="sm" className="h-auto justify-start px-0" onClick={() => { setDraft({ name: query, phone: "", email: "" }); setCreating(true); }}>
          <UserPlus aria-hidden />見つからない場合は新しく登録
        </Button>
      )}
    </div>
  );
}
