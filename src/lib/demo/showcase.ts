import type { Sql } from "postgres";
import { BLUEPRINTS } from "./blueprints";
import { generateDataset } from "./generate";
import { insertDataset } from "./insert";

export const SHOWCASE_USERS = {
  owner: "owner@reserveflow.example",
  manager: "manager@reserveflow.example",
  staff: "staff@reserveflow.example",
} as const;

/**
 * 見本の企業（公開予約ページ /book/demo-salon などで使う）を今日基準で作り直す。
 * ログイン用の利用者（パスワードは引数。Supabase Auth と同じ bcrypt 形式で保存）
 *   owner@   … 4社すべてのオーナー（店舗の切り替え・テナント分離の確認用）
 *   manager@ … 美容室のマネージャー
 *   staff@   … 美容室のスタッフ（佐藤 美咲）
 */
export async function rebuildShowcase(sql: Sql, options: { password?: string; now?: Date } = {}): Promise<void> {
  const now = options.now ?? new Date();
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('reserveflow:showcase'))`;
    await tx`select app_private.delete_organizations(array(select id from public.organizations where is_showcase))`;
    const ids: Record<string, string> = {};
    for (const [key, email] of Object.entries(SHOWCASE_USERS)) {
      const [row] = await tx<{ id: string }[]>`
        insert into auth.users (aud, role, email, encrypted_password, email_confirmed_at)
        values ('authenticated', 'authenticated', ${email},
                ${options.password ? tx`extensions.crypt(${options.password}, extensions.gen_salt('bf', 10))` : null}, now())
        on conflict (email) where email is not null do update set
          encrypted_password = coalesce(excluded.encrypted_password, auth.users.encrypted_password), updated_at = now()
        returning id`;
      ids[key] = row.id;
    }
    for (const [i, bp] of BLUEPRINTS.entries()) {
      const data = generateDataset(bp, { now, seed: 20261105 + i * 101, slug: bp.slug });
      const members: Parameters<typeof insertDataset>[2]["members"] = [
        { userId: ids.owner, role: "owner", displayName: "見本 オーナー" },
      ];
      if (i === 0) {
        members.push({ userId: ids.manager, role: "manager", displayName: "見本 マネージャー" });
        members.push({ userId: ids.staff, role: "staff", displayName: bp.staff[0].name, staffKey: bp.staff[0].key });
      }
      await insertDataset(tx, data, { isDemo: false, isShowcase: true, members });
    }
  });
}
