"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut, RotateCcw, UserRoundCog } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logout } from "@/lib/actions/auth";
import { resetDemo, switchDemoRole } from "@/lib/actions/demo";
import { ROLE_LABELS, type MemberRole } from "@/lib/auth/roles";

const ROLES: MemberRole[] = ["owner", "manager", "staff"];

export function UserMenu({ displayName, role, isDemo }: { displayName: string; role: MemberRole; isDemo: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const initial = displayName.replace(/^デモ\s*/, "").slice(0, 1) || "ユ";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-10 gap-2 px-1.5 sm:px-2" aria-label="ユーザーメニュー">
          <span className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            {initial}
          </span>
          <span className="hidden text-left leading-tight sm:block">
            <span className="block text-sm font-medium">{displayName}</span>
            <span className="block text-[11px] text-muted-foreground">{ROLE_LABELS[role]}</span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <div>{displayName}</div>
          <div className="text-xs font-normal text-muted-foreground">{ROLE_LABELS[role]}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isDemo && (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">立場を切り替えて権限の違いを体験</DropdownMenuLabel>
            {ROLES.filter((r) => r !== role).map((r) => (
              <DropdownMenuItem
                key={r}
                disabled={pending}
                onSelect={() =>
                  startTransition(async () => {
                    const result = await switchDemoRole(r);
                    if (!result.ok) {
                      toast.error(result.error);
                      return;
                    }
                    toast.success(`${ROLE_LABELS[r]}として表示しています`);
                    router.push("/dashboard");
                    router.refresh();
                  })
                }
              >
                <UserRoundCog />
                {ROLE_LABELS[r]}に切り替え
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              disabled={pending}
              onSelect={() =>
                startTransition(async () => {
                  const id = toast.loading("デモデータを作り直しています…");
                  const result = await resetDemo();
                  if (!result.ok) {
                    toast.error(result.error, { id });
                    return;
                  }
                  toast.success("デモデータを初期状態に戻しました", { id });
                  router.push("/dashboard");
                  router.refresh();
                })
              }
            >
              <RotateCcw />
              デモデータを初期化
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem disabled={pending} onSelect={() => startTransition(() => logout())}>
          <LogOut />
          {isDemo ? "デモを終了する" : "ログアウト"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
