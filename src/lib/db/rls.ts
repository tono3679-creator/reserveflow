import type { Sql, TransactionSql } from "postgres";

/**
 * ログインユーザーとして SQL を実行する。
 * トランザクションの中でロールを authenticated に切り替え、JWT の内容（sub）を設定するので、
 * RLS と auth.uid() がその利用者の権限で効く（アプリの処理は必ずここを通して DB を読み書きする）。
 */
export async function runAsUser<T>(
  sql: Sql,
  userId: string,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  const result = await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true), set_config('role', 'authenticated', true)`;
    return fn(tx);
  });
  return result as T;
}
