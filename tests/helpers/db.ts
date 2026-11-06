/**
 * DB のテスト用。テスト専用のデータベース（TEST_DATABASE_URL、既定 reserveflow_test）を作り直して使う。
 * ローカルの PostgreSQL に、Supabase の土台（db/local/supabase-shim.sql）とマイグレーションを適用する。
 */
import postgres, { type Sql, type TransactionSql } from "postgres";
import { migrate } from "../../scripts/db/migrate";
import { DB_TYPES } from "../../src/lib/db/types";
import { runAsUser } from "../../src/lib/db/rls";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
export const TEST_DB = process.env.TEST_DATABASE_NAME ?? "reserveflow_test";
export const TEST_URL = ADMIN_URL.replace(/\/[^/]*$/, `/${TEST_DB}`);

export async function resetTestDatabase(): Promise<void> {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists ${TEST_DB} with (force)`);
    await admin.unsafe(`create database ${TEST_DB}`);
  } finally {
    await admin.end();
  }
  const sql = postgres(TEST_URL, { max: 1, onnotice: () => {} });
  try {
    await migrate(sql, { local: true, log: () => {} });
  } finally {
    await sql.end();
  }
}

export function connect(): Sql {
  return postgres(TEST_URL, { max: 4, onnotice: () => {}, types: DB_TYPES });
}

/** ログイン利用者として（RLS を効かせて）実行する */
export function as<T>(sql: Sql, userId: string, fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
  return runAsUser(sql, userId, fn);
}

/** 未ログイン（anon）として実行する */
export async function asAnon<T>(sql: Sql, fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true)`;
    return fn(tx);
  }) as Promise<T>;
}

/** 期待どおりに失敗したときの PostgreSQL のエラーコード */
export async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}
