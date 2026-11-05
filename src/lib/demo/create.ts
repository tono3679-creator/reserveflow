import { randomBytes } from "node:crypto";
import type { Sql } from "postgres";
import { BLUEPRINTS } from "./blueprints";
import { generateDataset } from "./generate";
import { insertDataset } from "./insert";

export const DEMO_TTL_HOURS = 24;

function shortId(): string {
  // 公開予約ページの URL に使う（推測されにくい 8 文字）
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/**
 * デモ訪問者の環境を作る：利用者3人（オーナー・マネージャー・スタッフ）と、4業種の企業。
 * 戻り値はオーナーの利用者 ID（この人でログインした状態から始める）。
 */
export async function createDemoEnvironment(sql: Sql, now: Date = new Date()): Promise<{ sessionId: string; ownerUserId: string }> {
  return sql.begin(async (tx) => {
    const users = await tx<{ id: string }[]>`
      insert into auth.users (aud, role, is_anonymous, raw_user_meta_data)
      select 'authenticated', 'authenticated', true, jsonb_build_object('demo', true) from generate_series(1, 3)
      returning id`;
    const [owner, manager, staff] = users.map((u) => u.id);
    const expiresAt = new Date(now.getTime() + DEMO_TTL_HOURS * 3600_000);
    const [session] = await tx<{ id: string }[]>`
      insert into app_private.demo_sessions (owner_user_id, manager_user_id, staff_user_id, expires_at)
      values (${owner}, ${manager}, ${staff}, ${expiresAt}) returning id`;
    const suffix = shortId();
    for (const [i, bp] of BLUEPRINTS.entries()) {
      const data = generateDataset(bp, { now, seed: Date.now() % 100000 + i * 7919, slug: `${bp.slug}-${suffix}` });
      await insertDataset(tx, data, {
        isDemo: true,
        demoSessionId: session.id,
        demoExpiresAt: expiresAt,
        members: [
          { userId: owner, role: "owner", displayName: "デモ オーナー" },
          { userId: manager, role: "manager", displayName: "デモ マネージャー" },
          { userId: staff, role: "staff", displayName: `${bp.staff[0].name}（スタッフ）`, staffKey: bp.staff[0].key },
        ],
      });
    }
    return { sessionId: session.id, ownerUserId: owner };
  }) as Promise<{ sessionId: string; ownerUserId: string }>;
}

/** デモ訪問者の環境をまとめて消す（企業はデモ訪問者の削除で連鎖して消える） */
export async function deleteDemoEnvironment(sql: Sql, sessionId: string): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`select app_private.delete_organizations(array(select id from public.organizations where demo_session_id = ${sessionId}))`;
    const [s] = await tx<{ owner_user_id: string; manager_user_id: string; staff_user_id: string }[]>`
      delete from app_private.demo_sessions where id = ${sessionId} returning owner_user_id, manager_user_id, staff_user_id`;
    if (s) await tx`delete from auth.users where id in (${s.owner_user_id}, ${s.manager_user_id}, ${s.staff_user_id}) and is_anonymous`;
  });
}

/** 期限切れのデモ環境を片付ける（定期実行） */
export async function cleanupExpiredDemos(sql: Sql): Promise<number> {
  const expired = await sql<{ id: string }[]>`select id from app_private.demo_sessions where expires_at < now()`;
  for (const { id } of expired) await deleteDemoEnvironment(sql, id);
  await sql`delete from app_private.sessions where expires_at < now()`;
  await sql`delete from app_private.rate_limits where created_at < now() - interval '1 day'`;
  return expired.length;
}

/** 利用者が属するデモ訪問者 */
export async function demoSessionOf(sql: Sql, userId: string): Promise<{ id: string; owner: string; manager: string; staff: string } | null> {
  const [row] = await sql<{ id: string; owner_user_id: string; manager_user_id: string; staff_user_id: string }[]>`
    select id, owner_user_id, manager_user_id, staff_user_id from app_private.demo_sessions
     where ${userId} in (owner_user_id, manager_user_id, staff_user_id) and expires_at > now()`;
  return row ? { id: row.id, owner: row.owner_user_id, manager: row.manager_user_id, staff: row.staff_user_id } : null;
}
