"use client";
import { ErrorPanel } from "@/components/common/error-panel";

/** ログイン画面など、管理者・ドライバー画面の外で起きたエラー */
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <ErrorPanel error={error} retry={retry} contact="時間をおいてから再度アクセスしてください" />
    </div>
  );
}
