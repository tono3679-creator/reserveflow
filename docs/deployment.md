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
| `CRON_SECRET` | 16文字以上のランダムな値（Vercel Cron がこの値で定期処理を呼ぶ） |
| `APP_SECRET` | 32文字以上のランダムな値（予約の確認リンクの生成に使う。変えると発行済みのリンクは使えなくなる） |
| `APP_URL` | 公開する URL（例 `https://reserveflow.example.com`。未設定なら Vercel の本番 URL） |
| `RESEND_API_KEY` | 任意。設定するとメールを実際に送る（未設定なら通知はデモ表示） |
| `NOTIFY_FROM_EMAIL` | 任意。送信元（Resend で認証済みのドメインのアドレス） |
| `PUBLIC_BOOKING_LIMIT_PER_HOUR` | 任意。同じ接続元から1時間に受け付ける公開予約の数（既定 10） |

ランダムな値は `openssl rand -base64 48` などで作れます。

## 定期処理（Vercel Cron）

`vercel.json` に登録済みです（時刻は UTC）。

| パス | 時刻（日本時間） | 内容 |
| --- | --- | --- |
| `/api/cron/notifications` | 毎日 8:00 | 前日・当日リマインドの作成と、未送信の通知の送信 |
| `/api/cron/cleanup` | 毎日 3:00 | 期限切れのデモ環境の削除 |

## 補足

- データの読み書きはサーバーから PostgreSQL に直接接続して行い、RLS は接続ごとに利用者の権限へ切り替えて効かせます。
  ブラウザから Supabase の Data API（PostgREST）は使わないため、Supabase の設定で Data API を無効にしておくと、公開される入口を減らせます。
- `AUTH_PROVIDER=local` のままでも動きます（アプリ内のログイン）。Supabase を使わず Neon などの PostgreSQL で公開する場合もこの設定です。
