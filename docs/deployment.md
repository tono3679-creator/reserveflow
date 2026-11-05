# 公開手順（Vercel ＋ Supabase）

> Phase 6 で手順を確定し、公開後の E2E 確認を加えます。ここには現時点で決まっている内容を書いています。

## 必要なもの

| サービス | 用途 | 料金 |
| --- | --- | --- |
| Supabase | PostgreSQL・認証（Auth） | Free プランで可 |
| Vercel | Next.js のホスティング・定期実行（Cron） | Hobby（非商用）で可 |

秘密情報（DB のパスワード・キー）はチャットやソースコードに書かず、Vercel の環境変数に登録します。

## 手順の概要

1. Supabase でプロジェクトを作る（リージョンは Tokyo）。
2. マイグレーションを適用する：`DATABASE_URL_UNPOOLED=<Direct connection> npm run db:migrate`
   （または Supabase CLI の `supabase db push`。どちらも `supabase/migrations/` を順に適用します）。
3. Supabase の Authentication でメール＋パスワードを有効にする。
4. Vercel でリポジトリをインポートし、環境変数を登録する。

| 変数 | 値 |
| --- | --- |
| `DATABASE_URL` | Supabase の Transaction pooler の接続文字列 |
| `AUTH_PROVIDER` | `supabase` |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon（public）key |
| `CRON_SECRET` | 16文字以上のランダムな値 |

## 補足

- データの読み書きはサーバーから PostgreSQL に直接接続して行い、RLS は接続ごとに利用者の権限へ切り替えて効かせます。
  ブラウザから Supabase の Data API（PostgREST）は使わないため、Supabase の設定で Data API を無効にしておくと、公開される入口を減らせます。
- `AUTH_PROVIDER=local` のままでも動きます（アプリ内のログイン）。Supabase を使わず Neon などの PostgreSQL で公開する場合もこの設定です。
