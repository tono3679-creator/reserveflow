/**
 * 見本の企業（4業種）を作り直す。
 *   SEED_LOGIN_PASSWORD=… npm run db:seed
 * パスワードを渡すと owner@ / manager@ / staff@reserveflow.example でログインできる（AUTH_PROVIDER=local のとき）。
 */
import postgres from "postgres";
import { rebuildShowcase } from "../../src/lib/demo/showcase";
import { toPostgresJsUrl } from "../../src/lib/db/url";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL を設定してください");
  const password = process.env.SEED_LOGIN_PASSWORD;
  if (password && password.length < 12) throw new Error("SEED_LOGIN_PASSWORD は12文字以上にしてください");
  const sql = postgres(toPostgresJsUrl(url), { max: 1, prepare: false, onnotice: () => {} });
  try {
    const started = Date.now();
    await rebuildShowcase(sql, { password });
    const [counts] = await sql<{ orgs: number; bookings: number; customers: number }[]>`
      select (select count(*)::int from organizations where is_showcase) orgs,
             (select count(*)::int from bookings b join organizations o on o.id = b.organization_id where o.is_showcase) bookings,
             (select count(*)::int from customers c join organizations o on o.id = c.organization_id where o.is_showcase) customers`;
    console.log(`見本の企業 ${counts.orgs} 社・顧客 ${counts.customers} 名・予約 ${counts.bookings} 件（${Date.now() - started}ms）`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
