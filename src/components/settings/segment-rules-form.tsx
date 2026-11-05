"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Field } from "@/components/common/form-field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { updateSegmentRules } from "@/lib/actions/settings";
import { segmentRulesSchema, type SegmentRulesInput } from "@/lib/validation/settings";
import { SaveBar } from "./save-bar";

/** 顧客セグメント（リピーター・VIP・休眠）の基準 */
export function SegmentRulesForm({ initial }: { initial: SegmentRulesInput }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<SegmentRulesInput>({ resolver: zodResolver(segmentRulesSchema), defaultValues: initial });
  const errors = form.formState.errors;
  const num = { setValueAs: (v: string) => (v === "" ? Number.NaN : Number(v)) };
  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await updateSegmentRules(values);
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.message);
      form.reset(values);
      router.refresh();
    }),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>顧客セグメント</CardTitle>
        <CardDescription>
          来店 = 開始時刻を過ぎた「来店済み」「サービス完了」の予約。上から順に判定します：未来店（来店0回）→ 休眠 → VIP → リピーター → 新規。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="リピーターとする来店回数（以上）" htmlFor="seg-repeat" error={errors.repeatMinVisits?.message}>
              <Input id="seg-repeat" type="number" min={2} inputMode="numeric" {...form.register("repeatMinVisits", num)} />
            </Field>
            <Field label="休眠とみなす日数（最終来店から）" htmlFor="seg-dormant" error={errors.dormantDays?.message} hint="今後の予約がある顧客は休眠にしません">
              <Input id="seg-dormant" type="number" min={14} inputMode="numeric" {...form.register("dormantDays", num)} />
            </Field>
            <Field label="VIP の来店回数（以上）" htmlFor="seg-vip-visits" error={errors.vipMinVisits?.message}>
              <Input id="seg-vip-visits" type="number" min={2} inputMode="numeric" {...form.register("vipMinVisits", num)} />
            </Field>
            <Field label="VIP の累計利用額（円以上）" htmlFor="seg-vip-spend" error={errors.vipMinSpend?.message}>
              <Input id="seg-vip-spend" type="number" min={0} inputMode="numeric" {...form.register("vipMinSpend", num)} />
            </Field>
          </div>
          <SaveBar pending={pending} dirty={form.formState.isDirty} />
        </form>
      </CardContent>
    </Card>
  );
}
