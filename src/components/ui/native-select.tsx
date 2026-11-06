import * as React from "react";
import { cn } from "@/lib/utils";

/** ブラウザ標準の選択欄（スマートフォンで OS の選択画面が使え、フォームとも扱いやすい） */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-9 w-full rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
