"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";
import { Field } from "@/components/common/form-field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { updateLocationInfo } from "@/lib/actions/settings";
import { industryLabel } from "@/lib/domain/industry";
import { locationInfoSchema, TIMEZONES, type LocationInfoInput } from "@/lib/validation/settings";
import { SaveBar } from "./save-bar";

type Initial = { name: string; slug: string; industry: string; phone: string | null; email: string | null; address: string | null; logoUrl: string | null; timezone: string };

export function LocationInfoForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<LocationInfoInput, unknown, z.output<typeof locationInfoSchema>>({
    resolver: zodResolver(locationInfoSchema),
    defaultValues: {
      name: initial.name, phone: initial.phone ?? "", email: initial.email ?? "", address: initial.address ?? "",
      logoUrl: initial.logoUrl ?? "", timezone: initial.timezone as LocationInfoInput["timezone"],
    },
  });
  const errors = form.formState.errors;
  const onSubmit = form.handleSubmit(() =>
    startTransition(async () => {
      const values = form.getValues();
      const result = await updateLocationInfo(values);
      if (!result.ok) {
        toast.error(result.error);
        for (const [key, message] of Object.entries(result.fieldErrors ?? {})) form.setError(key as keyof LocationInfoInput, { message });
        return;
      }
      toast.success(result.message);
      form.reset(values);
      router.refresh();
    }),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>店舗情報</CardTitle>
        <CardDescription>お客様の予約画面・通知にも表示されます。業種：{industryLabel(initial.industry)}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="店舗名" htmlFor="name" required error={errors.name?.message}>
              <Input id="name" aria-invalid={!!errors.name} {...form.register("name")} />
            </Field>
            <Field label="電話番号" htmlFor="phone" error={errors.phone?.message}>
              <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" aria-invalid={!!errors.phone} {...form.register("phone")} />
            </Field>
            <Field label="メールアドレス" htmlFor="email" error={errors.email?.message}>
              <Input id="email" type="email" aria-invalid={!!errors.email} {...form.register("email")} />
            </Field>
            <Field label="タイムゾーン" htmlFor="timezone" hint="予約の時刻はこのタイムゾーンで表示・計算します" error={errors.timezone?.message}>
              <NativeSelect id="timezone" {...form.register("timezone")}>
                {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </NativeSelect>
            </Field>
            <Field label="住所" htmlFor="address" error={errors.address?.message} className="md:col-span-2">
              <Input id="address" autoComplete="street-address" aria-invalid={!!errors.address} {...form.register("address")} />
            </Field>
            <Field label="ロゴ画像の URL" htmlFor="logoUrl" hint="https:// で始まる画像の URL（任意）" error={errors.logoUrl?.message} className="md:col-span-2">
              <Input id="logoUrl" type="url" placeholder="https://" aria-invalid={!!errors.logoUrl} {...form.register("logoUrl")} />
            </Field>
          </div>
          <SaveBar pending={pending} dirty={form.formState.isDirty} />
        </form>
      </CardContent>
    </Card>
  );
}
