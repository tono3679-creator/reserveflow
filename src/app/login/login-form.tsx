"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { Field } from "@/components/common/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { login } from "@/lib/actions/auth";
import { loginSchema, type LoginInput } from "@/lib/validation/auth";

export function LoginForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await login(values);
      if (!result.ok) {
        form.setError("root", { message: result.error });
        return;
      }
      router.push("/dashboard");
      router.refresh();
    }),
  );
  const errors = form.formState.errors;
  return (
    <form onSubmit={onSubmit} className="mt-5 grid gap-4" noValidate>
      <Field label="メールアドレス" htmlFor="email" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...form.register("email")} />
      </Field>
      <Field label="パスワード" htmlFor="password" error={errors.password?.message}>
        <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...form.register("password")} />
      </Field>
      {errors.root && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-strong">{errors.root.message}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        ログイン
      </Button>
    </form>
  );
}
