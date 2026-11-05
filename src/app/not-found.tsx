import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <SearchX className="size-10 text-muted-foreground" aria-hidden />
      <h1 className="text-lg font-semibold">ページが見つかりません</h1>
      <p className="text-keep text-sm text-muted-foreground">
        URL が間違っているか、データが削除された可能性があります。権限のないデータは表示されません。
      </p>
      <Button asChild><Link href="/">トップへ戻る</Link></Button>
    </div>
  );
}
