"use client";
import { useEffect, useRef, useTransition } from "react";
import { Loader2, TriangleAlert, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOnline } from "@/lib/hooks/use-online";
import { cn } from "@/lib/utils";

/**
 * 画面の表示に失敗したとき（error.tsx）の共通表示。
 * 通信が切れているときはその旨を出し、つながったら自動で読み込み直す。
 */
export function ErrorPanel({
  error, retry, contact, className,
}: { error: unknown; retry: () => void; contact: string; className?: string }) {
  const online = useOnline();
  const [pending, startTransition] = useTransition();
  const prevOnline = useRef(online);
  const digest = error && typeof error === "object" && "digest" in error && typeof error.digest === "string" ? error.digest : null;

  useEffect(() => {
    console.error(error);
  }, [error]);

  // 通信が戻ったら読み込み直す
  useEffect(() => {
    if (online && !prevOnline.current) startTransition(() => retry());
    prevOnline.current = online;
  }, [online, retry]);

  const Icon = online ? TriangleAlert : WifiOff;
  return (
    <div role="alert" className={cn("mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border bg-card px-6 py-12 text-center", className)}>
      <Icon className={cn("size-8", online ? "text-destructive" : "text-muted-foreground")} aria-hidden />
      <h2 className="text-lg font-semibold">{online ? "画面を表示できませんでした" : "通信できません"}</h2>
      <p className="text-keep text-sm text-muted-foreground">
        {online
          ? `一時的な問題の可能性があります。もう一度お試しください。繰り返し発生する場合は${contact}。`
          : "電波の良い場所に移動するか、接続を確認してください。つながると自動で読み込み直します。"}
      </p>
      {digest && <p className="text-xs text-muted-foreground">エラーID：{digest}</p>}
      <Button onClick={() => startTransition(() => retry())} disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        もう一度読み込む
      </Button>
    </div>
  );
}
