/**
 * Vercel のビルドの前処理（package.json の vercel-build から呼ぶ）。
 *
 * 本番デプロイ（VERCEL_ENV=production）のときだけ、次を行ってから next build に進む。
 *   1. 必要な環境変数の確認（足りなければビルドを止め、何を設定するかを表示する）
 *   2. マイグレーション（supabase/migrations の未適用分）。
 *      Supabase なら auth スキーマがあるのでそのまま、auth スキーマの無い PostgreSQL（Neon など）なら
 *      先に db/local/supabase-shim.sql（Supabase の土台の再現）を適用する。
 *   3. 見本の企業（公開予約ページ /book/demo-salon など）を今日基準で作り直す
 * プレビューや手元のビルドでは DB に触らない。
 */
import postgres from "postgres";
import { migrate } from "../db/migrate";
import { rebuildShowcase } from "../../src/lib/demo/showcase";
import { toPostgresJsUrl } from "../../src/lib/db/url";

function requireEnv(): string[] {
  const problems: string[] = [];
  const e = process.env;
  if (!e.DATABASE_URL) problems.push("DATABASE_URL：PostgreSQL の接続文字列（Supabase なら Transaction pooler）");
  if ((e.APP_SECRET ?? "").length < 32) problems.push("APP_SECRET：32文字以上のランダムな値（予約の確認リンクに使う）");
  if ((e.CRON_SECRET ?? "").length < 16) problems.push("CRON_SECRET：16文字以上のランダムな値（定期処理の認証）");
  if (e.AUTH_PROVIDER === "supabase" && (!e.NEXT_PUBLIC_SUPABASE_URL || !e.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
    problems.push("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY：AUTH_PROVIDER=supabase のときに必要");
  }
  if (e.SEED_LOGIN_PASSWORD && e.SEED_LOGIN_PASSWORD.length < 12) problems.push("SEED_LOGIN_PASSWORD：設定する場合は12文字以上");
  return problems;
}

async function main() {
  if (process.env.VERCEL_ENV !== "production") {
    console.log(`[vercel-build] 本番デプロイではないため（VERCEL_ENV=${process.env.VERCEL_ENV ?? "未設定"}）、DB の準備は行いません`);
    return;
  }
  const problems = requireEnv();
  if (problems.length > 0) {
    console.error("[vercel-build] 環境変数が足りません。Vercel の Settings → Environment Variables で設定してから Redeploy してください：");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  // マイグレーションは直接接続（Session pooler）が望ましい。無ければ DATABASE_URL を使う
  const url = process.env.DATABASE_URL_UNPOOLED || (process.env.DATABASE_URL as string);
  const sql = postgres(toPostgresJsUrl(url), { max: 1, prepare: false, onnotice: () => {}, connect_timeout: 20 });
  try {
    const [{ has_auth, trusted }] = await sql<{ has_auth: boolean; trusted: boolean }[]>`
      select to_regclass('auth.users') is not null has_auth,
             (select rolsuper or rolbypassrls from pg_roles where rolname = current_user) trusted`;
    // サーバーの信頼接続（公開予約・デモ作成・定期処理）は RLS を通らない利用者で行う設計。
    // Supabase の postgres ロールは BYPASSRLS を持つ。持たない利用者だと見本の作成や公開予約が RLS で拒否される
    if (!trusted) {
      console.error("[vercel-build] DATABASE_URL の利用者に BYPASSRLS がありません。Supabase では postgres ロールの接続文字列を使ってください。");
      process.exit(1);
    }
    console.log(`[vercel-build] マイグレーション（${has_auth ? "Supabase の auth スキーマを利用" : "auth スキーマが無いため土台を作成"}）`);
    await migrate(sql, { local: !has_auth, log: (line) => console.log(`[vercel-build] ${line}`) });
    const started = Date.now();
    await rebuildShowcase(sql, { password: process.env.SEED_LOGIN_PASSWORD || undefined });
    console.log(`[vercel-build] 見本の企業を作り直しました（${Date.now() - started}ms）`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("[vercel-build] 失敗しました：", error);
  process.exit(1);
});
