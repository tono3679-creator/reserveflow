"use client";
import { useTransition } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { startDemo } from "@/lib/actions/demo";

/** 業種を選んでデモを始める（登録不要。訪問者専用のデータを作る） */
export function DemoStartButton({ industry, label, variant = "brand" }: { industry?: string; label: string; variant?: "brand" | "outline" }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="lg"
      variant={variant}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await startDemo(industry);
          // 成功するとダッシュボードへ移動する（戻り値は失敗のときだけ）
          if (result && !result.ok) toast.error(result.error);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {pending ? "デモを準備しています…" : label}
      {!pending && <ArrowRight aria-hidden />}
    </Button>
  );
}
