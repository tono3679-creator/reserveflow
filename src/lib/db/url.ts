/**
 * 接続文字列を postgres.js で使える形に整える。
 *
 * Neon の接続文字列には、psql などの libpq 向けの `channel_binding=require` が付いている。
 * postgres.js は知らない項目を DB への接続パラメータとしてそのまま送るため、PostgreSQL が
 * 「unrecognized configuration parameter "channel_binding"」で接続を断る。
 * postgres.js はチャネルバインディングに対応していないので、この項目だけを外す
 * （`sslmode=require` による TLS と、パスワードの SCRAM 認証はそのまま使う）。
 */
export function toPostgresJsUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!parsed.searchParams.has("channel_binding")) return url;
  parsed.searchParams.delete("channel_binding");
  return parsed.toString();
}
