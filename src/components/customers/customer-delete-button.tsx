"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { deleteCustomer } from "@/lib/actions/customers";

/** 予約のない顧客だけ削除できる（予約がある場合はボタンを出さず理由を表示する） */
export function CustomerDeleteButton({ customerId, name, bookingCount }: { customerId: string; name: string; bookingCount: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (bookingCount > 0) {
    return <p className="text-xs text-muted-foreground">予約の履歴があるため、この顧客は削除できません。</p>;
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive"><Trash2 aria-hidden />削除</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{name} 様を削除しますか？</AlertDialogTitle>
          <AlertDialogDescription>顧客情報とメモが削除されます。元に戻せません。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>やめる</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const result = await deleteCustomer(customerId);
                if (!result.ok) return void toast.error(result.error);
                toast.success(result.message);
                router.push("/customers");
              });
            }}
          >
            {pending && <Loader2 className="animate-spin" aria-hidden />}削除する
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
