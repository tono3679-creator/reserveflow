/**
 * データベースのマイグレーション。
 *   npm run db:migrate            … DATABASE_URL（無ければ .env.local）の DB に適用する
 *   npm run db:migrate -- --local … ローカル PostgreSQL 用。先に db/local/supabase-shim.sql（Supabase の土台の再現）を適用する
 *
 * supabase/migrations/*.sql のうち未適用のものを名前の順に1ファイルずつ（ファイルごとに1トランザクション）適用し、
 * app_meta.migrations に記録する。Supabase CLI（supabase db push）で適用しても同じ結果になる。
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres, { type Sql } from "postgres";
import { toPostgresJsUrl } from "../../src/lib/db/url";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SHIM = "db/local/supabase-shim.sql";
const DIR = "supabase/migrations";

export async function migrate(sql: Sql, options: { local?: boolean; log?: (line: string) => void } = {}): Promise<string[]> {
  const log = options.log ?? console.log;
  await sql`select pg_advisory_lock(hashtext('reserveflow:migrate'))`;
  try {
    if (options.local) await sql.unsafe(await readFile(path.join(ROOT, SHIM), "utf8"));
    await sql`create schema if not exists app_meta`;
    await sql`revoke all on schema app_meta from public`;
    await sql`create table if not exists app_meta.migrations (name text primary key, applied_at timestamptz not null default now())`;
    const done = new Set((await sql<{ name: string }[]>`select name from app_meta.migrations`).map((r) => r.name));
    const files = (await readdir(path.join(ROOT, DIR))).filter((f) => f.endsWith(".sql")).sort();
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const body = await readFile(path.join(ROOT, DIR, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into app_meta.migrations (name) values (${file})`;
      });
      applied.push(file);
      log(`適用: ${file}`);
    }
    if (applied.length === 0) log("マイグレーション：新しいものはありません");
    return applied;
  } finally {
    await sql`select pg_advisory_unlock(hashtext('reserveflow:migrate'))`;
  }
}

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL を設定してください（.env.example を参照）");
  const sql = postgres(toPostgresJsUrl(url), { max: 1, prepare: false, onnotice: () => {} });
  try {
    await migrate(sql, { local: process.argv.includes("--local") });
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
