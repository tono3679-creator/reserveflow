import "server-only";

/** サーバー専用の環境変数（値はコードに書かず、.env.local / Vercel の環境変数で渡す。一覧は .env.example） */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`環境変数 ${name} が設定されていません（.env.example を参照）`);
  return value;
}

function positiveInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export type AuthProvider = "supabase" | "local";

export const serverEnv = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  /** supabase：Supabase Auth でログイン／local：アプリ内のログイン（Supabase に接続できない開発・テスト用） */
  get authProvider(): AuthProvider {
    const v = process.env.AUTH_PROVIDER;
    if (v === "supabase" || v === "local") return v;
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? "supabase" : "local";
  },
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get cronSecret() {
    return process.env.CRON_SECRET ?? "";
  },
  /** 同時に存在できるデモ環境の数 */
  get demoMaxActive() {
    return positiveInt("DEMO_MAX_ACTIVE", 50);
  },
  /** 同じ接続元から1時間に作れるデモ環境の数 */
  get demoCreateLimitPerHour() {
    return positiveInt("DEMO_CREATE_LIMIT_PER_HOUR", 20);
  },
};
