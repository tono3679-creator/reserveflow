import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Logo } from "@/components/layout/logo";
import { getContext } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "ログイン" };

export default async function LoginPage() {
  if (await getContext()) redirect("/dashboard");
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex justify-center"><Logo /></Link>
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h1 className="text-lg font-bold">ログイン</h1>
          <p className="mt-1 text-sm text-muted-foreground">店舗のアカウントでログインしてください。</p>
          <LoginForm />
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          アカウントがなくても、<Link href="/#demo" className="font-medium text-brand hover:underline">デモ</Link>ですべての機能を試せます。
        </p>
      </div>
    </main>
  );
}
