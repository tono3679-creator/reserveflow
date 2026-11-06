import { FlaskConical } from "lucide-react";
import { ROLE_LABELS, type MemberRole } from "@/lib/auth/roles";

/** デモ中であることと、データの扱いを常に表示する */
export function DemoBanner({ role }: { role: MemberRole }) {
  return (
    <div className="flex items-center gap-2 bg-brand px-4 py-1.5 text-xs text-white sm:px-6">
      <FlaskConical className="size-3.5 shrink-0" aria-hidden />
      <p className="text-keep">
        デモ環境（{ROLE_LABELS[role]}として表示中）。データはすべて架空で、あなた専用です。24時間後に自動で削除されます。右上のメニューから立場の切り替え・初期化ができます。
      </p>
    </div>
  );
}
