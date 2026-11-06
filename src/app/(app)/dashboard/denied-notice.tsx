import { ShieldAlert } from "lucide-react";

export function DeniedNotice() {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-strong">
      <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="text-keep">開こうとした画面は、今の立場（役割）では利用できません。必要な場合はオーナーに権限の変更を依頼してください。</p>
    </div>
  );
}
