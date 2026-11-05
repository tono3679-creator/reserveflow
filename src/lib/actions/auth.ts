"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/auth";
import { LOCATION_COOKIE } from "@/lib/auth/cookies";
import { clientIp, recordHit, underLimit } from "@/lib/auth/rate-limit";
import { endSession, startSession } from "@/lib/auth/session";
import { supabaseServer } from "@/lib/auth/supabase";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { loginSchema } from "@/lib/validation/auth";
import { endDemo } from "./demo";
import { runAction, UserFacingError, type ActionResult } from "./result";

const LOGIN_FAILURE_LIMIT = 10; // 15分あたり（接続元＋メールアドレスごと）

export async function login(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { email, password } = loginSchema.parse(input);
    const bucket = `login:${await clientIp()}:${email.toLowerCase()}`;
    if (!(await underLimit(bucket, LOGIN_FAILURE_LIMIT, 15 * 60))) {
      throw new UserFacingError("ログインの失敗が続いたため、しばらく時間をおいてからお試しください。");
    }
    const fail = async (): Promise<never> => {
      await recordHit(bucket);
      throw new UserFacingError("メールアドレスまたはパスワードが正しくありません。");
    };
    if (serverEnv.authProvider === "supabase") {
      const supabase = await supabaseServer();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return fail();
      return undefined;
    }
    // ローカル：Supabase Auth と同じ bcrypt 形式のパスワードを DB で照合する
    const [user] = await db()<{ id: string }[]>`
      select id from auth.users
       where lower(email) = lower(${email}) and not is_anonymous and encrypted_password is not null
         and encrypted_password = extensions.crypt(${password}, encrypted_password)`;
    if (!user) return fail();
    await startSession(user.id);
    return undefined;
  });
}

export async function logout(): Promise<void> {
  const ctx = await getContext();
  // デモはログアウトでデータも消す（もう一度入る手段がないため）
  if (ctx?.isDemo) await endDemo();
  await endSession();
  if (serverEnv.authProvider === "supabase" && !ctx?.isAnonymous) {
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
  }
  (await cookies()).delete(LOCATION_COOKIE);
  redirect(ctx?.isDemo ? "/" : "/login");
}

/** 表示する店舗を切り替える（所属していない店舗は選べない） */
export async function switchLocation(locationId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await getContext();
    if (!ctx) throw new UserFacingError("ログインしてください");
    if (!ctx.locations.some((l) => l.id === locationId)) throw new UserFacingError("この店舗は選べません");
    (await cookies()).set(LOCATION_COOKIE, locationId, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 365 * 24 * 3600,
    });
    return undefined;
  });
}
