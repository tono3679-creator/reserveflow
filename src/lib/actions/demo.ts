"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/auth";
import { LOCATION_COOKIE } from "@/lib/auth/cookies";
import { clientIp, hit } from "@/lib/auth/rate-limit";
import type { MemberRole } from "@/lib/auth/roles";
import { startSession, switchSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createDemoEnvironment, deleteDemoEnvironment, demoSessionOf, DEMO_TTL_HOURS } from "@/lib/demo/create";
import { serverEnv } from "@/lib/env";
import { runAction, UserFacingError, type ActionResult } from "./result";

/** 「デモを体験」：訪問者専用の環境を作り、オーナーとしてログインした状態にする */
export async function startDemo(industry?: string): Promise<ActionResult> {
  const result = await runAction(async () => {
    const sql = db();
    const [active] = await sql<{ n: number }[]>`select count(*)::int n from app_private.demo_sessions where expires_at > now()`;
    if (active.n >= serverEnv.demoMaxActive) {
      throw new UserFacingError("ただいまデモが混み合っています。時間をおいてからお試しください。");
    }
    if (!(await hit(`demo:${await clientIp()}`, serverEnv.demoCreateLimitPerHour, 3600))) {
      throw new UserFacingError("短時間に続けてデモを作成したため、しばらく時間をおいてからお試しください。");
    }
    const { ownerUserId } = await createDemoEnvironment(sql);
    await startSession(ownerUserId, DEMO_TTL_HOURS * 3600_000);
    // 選んだ業種の店舗から始める
    const [loc] = await sql<{ id: string }[]>`
      select l.id from public.locations l join public.organization_members m on m.organization_id = l.organization_id
       where m.user_id = ${ownerUserId} and (${industry ?? null}::text is null or l.industry = ${industry ?? null})
       order by l.created_at limit 1`;
    const store = await cookies();
    if (loc) store.set(LOCATION_COOKIE, loc.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
    return undefined;
  });
  if (result.ok) redirect("/dashboard");
  return result;
}

/** デモの中で、オーナー・マネージャー・スタッフの立場を切り替える（同じ訪問者の3人の中だけ） */
export async function switchDemoRole(role: MemberRole): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await getContext();
    if (!ctx?.isDemo) throw new UserFacingError("デモでのみ使えます");
    const demo = await demoSessionOf(db(), ctx.userId);
    if (!demo) throw new UserFacingError("デモの期限が切れました。トップページからもう一度お試しください。");
    const target = role === "owner" ? demo.owner : role === "manager" ? demo.manager : demo.staff;
    if (!(await switchSessionUser(target))) throw new UserFacingError("切り替えられませんでした");
    return undefined;
  });
}

/** デモデータを初期状態に戻す（この訪問者の環境だけを作り直す） */
export async function resetDemo(): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await getContext();
    if (!ctx?.isDemo) throw new UserFacingError("デモでのみ使えます");
    const sql = db();
    const demo = await demoSessionOf(sql, ctx.userId);
    if (!demo) throw new UserFacingError("デモの期限が切れました。トップページからもう一度お試しください。");
    const selectedIndustry = ctx.location.industry;
    await deleteDemoEnvironment(sql, demo.id);
    const { ownerUserId } = await createDemoEnvironment(sql);
    await startSession(ownerUserId, DEMO_TTL_HOURS * 3600_000);
    const [loc] = await sql<{ id: string }[]>`
      select l.id from public.locations l join public.organization_members m on m.organization_id = l.organization_id
       where m.user_id = ${ownerUserId} and l.industry = ${selectedIndustry} limit 1`;
    if (loc) (await cookies()).set(LOCATION_COOKIE, loc.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
    return undefined;
  });
}

/** デモを終了する（この訪問者のデータをすべて消す） */
export async function endDemo(): Promise<void> {
  const ctx = await getContext();
  if (ctx?.isDemo) {
    const demo = await demoSessionOf(db(), ctx.userId);
    if (demo) await deleteDemoEnvironment(db(), demo.id);
  }
}
