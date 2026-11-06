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
  /**
   * 予約の確認・変更用リンクを作る秘密の値（32文字以上）。本番では必須。
   * 開発・テストでは固定の値を使う（この値で作ったリンクは本番では使えない）。
   */
  get appSecret() {
    const v = process.env.APP_SECRET;
    if (v && v.length >= 32) return v;
    if (process.env.NODE_ENV === "production" && !process.env.E2E_ALLOW_DEV_SECRET) {
      throw new Error("環境変数 APP_SECRET（32文字以上）が設定されていません（.env.example を参照）");
    }
    return "reserveflow-development-only-secret-do-not-use";
  },
  /** 通知の本文に入れるリンクの基準 URL */
  get appUrl() {
    const v = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
    return (v || "http://localhost:3000").replace(/\/$/, "");
  },
  /** メール送信（Resend）。どちらかが空なら送信せず「デモ通知」として記録する */
  get resendApiKey() {
    return process.env.RESEND_API_KEY ?? "";
  },
  get notifyFromEmail() {
    return process.env.NOTIFY_FROM_EMAIL ?? "";
  },
  /** 同時に存在できるデモ環境の数 */
  get demoMaxActive() {
    return positiveInt("DEMO_MAX_ACTIVE", 50);
  },
  /** 同じ接続元から1時間に作れるデモ環境の数 */
  get demoCreateLimitPerHour() {
    return positiveInt("DEMO_CREATE_LIMIT_PER_HOUR", 20);
  },
  /** 同じ接続元から1時間に受け付ける公開予約の数（変更・キャンセルはこの2倍） */
  get publicBookingLimitPerHour() {
    return positiveInt("PUBLIC_BOOKING_LIMIT_PER_HOUR", 10);
  },
};
