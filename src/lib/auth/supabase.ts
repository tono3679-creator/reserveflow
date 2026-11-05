import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { serverEnv } from "@/lib/env";

/**
 * Supabase Auth のクライアント（AUTH_PROVIDER=supabase のときだけ使う）。
 * 使うのは認証（ログイン・ログアウト・利用者の確認）だけで、データの読み書きは postgres.js ＋ RLS で行う。
 */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(serverEnv.supabaseUrl, serverEnv.supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server Component からは Cookie を書けない（proxy.ts がセッションを更新する）
        }
      },
    },
  });
}

/** Supabase Auth のログイン中の利用者（署名を検証した JWT の sub） */
export async function supabaseUserId(): Promise<string | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return data.claims.sub;
}
