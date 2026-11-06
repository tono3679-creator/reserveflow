/**
 * Content Security Policy。
 *   スクリプトはリクエストごとの nonce が付いたもの（とそこから読み込まれたもの）だけ実行する。
 *   通信先は自分のサイトと（使う場合は）Supabase Auth だけ。画像は自分のサイトと https のロゴ画像。
 *   ほかのサイトの iframe に埋め込ませない（クリックジャッキング対策）。
 */
export function buildCsp(nonce: string, options: { dev: boolean; supabaseUrl?: string }): string {
  const supabase = options.supabaseUrl ? new URL(options.supabaseUrl).origin : null;
  const directives: Record<string, (string | null | undefined | false)[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", options.dev && "'unsafe-eval'"],
    // React の style 属性・カレンダー・グラフのインラインスタイルのため
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", supabase],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => [name, ...values.filter(Boolean)].join(" "))
    .join("; ");
}

/** 推測できない nonce（リクエストごとに作る） */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
