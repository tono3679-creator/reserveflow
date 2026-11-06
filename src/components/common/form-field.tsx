import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** フォームの1項目（ラベル・必須表示・エラー文） */
export function Field({ label, htmlFor, error, required, hint, children, className }: {
  label: string; htmlFor: string; error?: string; required?: boolean; hint?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-xs text-destructive">必須</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">{error}</p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
