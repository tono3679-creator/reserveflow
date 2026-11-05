import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SaveBar({ pending, dirty }: { pending: boolean; dirty: boolean }) {
  return (
    <div className="flex items-center justify-end gap-3 border-t pt-4">
      {dirty && !pending && <span className="text-xs text-muted-foreground">保存していない変更があります</span>}
      <Button type="submit" disabled={pending || !dirty}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        保存する
      </Button>
    </div>
  );
}
