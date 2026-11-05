import "server-only";
import { z } from "zod";
import { AuthError } from "@/lib/auth";

export type ActionResult<T = void> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export class UserFacingError extends Error {}

/** PostgreSQL のエラーを、利用者に見せてよい文に置き換える（内部の情報は出さない） */
export function describeDbError(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: string }).code;
  const constraint = (error as { constraint_name?: string }).constraint_name ?? "";
  switch (code) {
    case "23P01":
      if (constraint.includes("resource")) return "同じ時間に設備がすでに使われています。別の時間を選んでください。";
      if (constraint.includes("staff")) return "同じ時間にこのスタッフの予約がすでに入っています。別の時間かスタッフを選んでください。";
      return "ほかの登録と時間が重なっています。";
    case "23505":
      return "同じ内容がすでに登録されています。";
    case "23503":
      return "関連するデータがあるため、この操作はできません。";
    case "23514":
      return "入力内容が条件を満たしていません。";
    case "42501":
      return "この操作を行う権限がありません。";
    case "P0001": {
      // DB 関数が raise exception で返した、利用者向けの文
      const message = (error as { message?: string }).message;
      return message ?? null;
    }
    default:
      return null;
  }
}

/** Server Action の共通の後始末：想定したエラーは文に、それ以外は記録して一般的な文にする */
export async function runAction<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message };
  } catch (error) {
    if (error instanceof AuthError || error instanceof UserFacingError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of error.issues) {
        const key = issue.path.join(".");
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return { ok: false, error: "入力内容を確認してください", fieldErrors };
    }
    const described = describeDbError(error);
    if (described) return { ok: false, error: described };
    // redirect() などの Next.js の制御用の例外はそのまま投げ直す
    if (error && typeof error === "object" && "digest" in error) throw error;
    console.error(error);
    return { ok: false, error: "処理できませんでした。時間をおいてもう一度お試しください。" };
  }
}
