"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Field } from "@/components/common/form-field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { updateSuggestionWeights } from "@/lib/actions/settings";
import { FACTOR_LABELS, type FactorKey } from "@/lib/suggestions/engine";
import { suggestionWeightsSchema, type SuggestionWeightsInput } from "@/lib/validation/suggestions";
import { SaveBar } from "./save-bar";

const HINTS: Record<FactorKey, string> = {
  preferredTime: "希望時刻との差が小さく、希望日に近い枠を優先します",
  gap: "前後に使いにくい半端な空き時間を残さない枠を優先します",
  balance: "その日の稼働率が低いスタッフへの割り当てを優先します",
  idle: "店舗全体で手が空いている時間帯を優先します",
};
const KEYS: FactorKey[] = ["preferredTime", "gap", "balance", "idle"];

/** スマート空き枠提案のスコアの重み（0〜100。合計に対する割合で効く） */
export function SuggestionWeightsForm({ initial }: { initial: SuggestionWeightsInput }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<SuggestionWeightsInput>({ resolver: zodResolver(suggestionWeightsSchema), defaultValues: initial });
  const errors = form.formState.errors;
  const values = useWatch({ control: form.control });
  const total = KEYS.reduce((s, k) => s + (Number.isFinite(values[k]) ? Number(values[k]) : 0), 0);
  const num = { setValueAs: (v: string) => (v === "" ? Number.NaN : Number(v)) };
  const onSubmit = form.handleSubmit((v) =>
    startTransition(async () => {
      const result = await updateSuggestionWeights(v);
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.message);
      form.reset(v);
      router.refresh();
    }),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>スマート空き枠提案の重み</CardTitle>
        <CardDescription>
          候補の点数は、4つの項目（それぞれ 0〜1）を下の重みで加重平均した 0〜100 点です。重みは合計に対する割合で効きます。0 にした項目は使いません。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            {KEYS.map((k) => {
              const v = Number.isFinite(values[k]) ? Number(values[k]) : 0;
              const share = total > 0 ? Math.round((v / total) * 100) : 0;
              return (
                <Field key={k} label={FACTOR_LABELS[k]} htmlFor={`w-${k}`} error={errors[k]?.message} hint={`${HINTS[k]}（現在の割合 ${share}%）`}>
                  <Input id={`w-${k}`} type="number" min={0} max={100} inputMode="numeric" {...form.register(k, num)} />
                </Field>
              );
            })}
          </div>
          <SaveBar pending={pending} dirty={form.formState.isDirty} />
        </form>
      </CardContent>
    </Card>
  );
}
