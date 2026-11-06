"use client";
import { ErrorPanel } from "@/components/common/error-panel";

export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorPanel error={error} retry={retry} contact="ページを再読み込みするか、時間をおいてからお試しください" className="mt-10" />;
}
