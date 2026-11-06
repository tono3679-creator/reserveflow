# 公開手順（Vercel ＋ Supabase）

アカウントの作成と秘密の値（DB のパスワード・キー）の登録は、ご本人が各サービスの画面で行います。
秘密の値はチャットやソースコードに書かず、Vercel の環境変数にだけ登録します。

## 必要なもの

| サービス | 用途 | 料金 |
| --- | --- | --- |
| Supabase | PostgreSQL（認証を Supabase Auth にする場合は Auth も） | Free プランで可 |
| Vercel | Next.js のホスティング・定期実行（Cron） | Hobby（非商用）で可 |
| Resend | 任意。メールを実際に送る場合だけ | Free プランで可 |

## 手順

### 1. Supabase でプロジェクトを作る

1. Supabase で New project を作る（Region は Northeast Asia (Tokyo)）。Database password は控えておく。
2. プロジェクト画面の上部のバーにある **Connect** ボタンを押し、Connection String タブで次の2つをコピーする（`[YOUR-PASSWORD]` は 1. のパスワードに置き換える）。
   - **Transaction pooler**（ポート 6543）… アプリの接続用 → `DATABASE_URL`
   - **Session pooler**（ポート 5432）… マイグレーション用 → `DATABASE_URL_UNPOOLED`
   - Direct connection は IPv6 だけのため、Vercel のビルドからは使えません。
3. どちらも利用者は `postgres`（`postgres.xxxx`）のままにする。アプリのサーバー処理（公開予約・デモ作成・定期処理）は、RLS を通らない `postgres` ロールで行う設計です（ログイン中の操作は、接続ごとに `authenticated` ロールに切り替えて RLS を効かせます）。

テーブルの作成（マイグレーション）は、Vercel の本番デプロイのときに自動で行います（手順 3）。

### 2. Vercel でリポジトリをインポートし、環境変数を登録する

Vercel の Add New → Project でこのリポジトリを選び、Environment Variables に次を登録する（Production と Preview）。

| 変数 | 値 | 必須 |
| --- | --- | --- |
| `DATABASE_URL` | Supabase の Transaction pooler の接続文字列 | ○ |
| `DATABASE_URL_UNPOOLED` | Supabase の Session pooler の接続文字列 | ○（マイグレーション用） |
| `APP_SECRET` | 32文字以上のランダムな値（予約の確認リンクに使う。変えると発行済みのリンクは使えなくなる） | ○ |
| `CRON_SECRET` | 16文字以上のランダムな値（Vercel Cron がこの値で定期処理を呼ぶ） | ○ |
| `AUTH_PROVIDER` | `local`（アプリ内のログイン。既定）または `supabase` | |
| `SEED_LOGIN_PASSWORD` | 12文字以上。見本の企業に `owner@reserveflow.example` でログインするときのパスワード | |
| `APP_URL` | 公開する URL（未設定なら Vercel の本番 URL） | |
| `RESEND_API_KEY`・`NOTIFY_FROM_EMAIL` | メールを実際に送る場合（未設定なら通知はデモ表示） | |
| `NEXT_PUBLIC_SUPABASE_URL`・`NEXT_PUBLIC_SUPABASE_ANON_KEY` | `AUTH_PROVIDER=supabase` のときだけ | |
| `DEMO_MAX_ACTIVE`・`DEMO_CREATE_LIMIT_PER_HOUR`・`PUBLIC_BOOKING_LIMIT_PER_HOUR` | 上限の変更（既定 50・20・10） | |

ランダムな値は `openssl rand -base64 48` などで作れます。

デモはアカウント登録なしで使えるため、`AUTH_PROVIDER=local` のままで全機能を体験できます。
`supabase` にすると Supabase Auth のメール＋パスワードでログインしますが、作業環境から Supabase に接続できないため、この組み合わせは未確認です。

### 3. デプロイする

Deploy を押すと、`npm run vercel-build`（`scripts/deploy/vercel-build.ts`）が本番デプロイのときだけ次を行ってから `next build` します。

1. 必要な環境変数の確認（足りなければ、何を設定するかを表示してビルドを止める）
2. 接続した利用者が RLS を通らない（BYPASSRLS）ことの確認
3. マイグレーション（`supabase/migrations/` の未適用分。`app_meta.migrations` に記録するので、2回目以降は差分だけ）
4. 見本の企業（`/book/demo-salon` など）を今日基準で作り直す

プレビューデプロイでは DB に触りません。

### 4. 公開後の確認

GitHub の Actions → **Production E2E** → Run workflow で、`base_url` に公開 URL を入れて実行します。
ブラウザでの E2E（デモ・権限・予約・公開予約・分析・空き枠提案）を公開 URL に対して行います。DB の接続情報は使いません。
見本の企業へのログインも確かめる場合は、リポジトリの Secret に `E2E_LOGIN_PASSWORD`（`SEED_LOGIN_PASSWORD` と同じ値）を登録します。

## 定期処理（Vercel Cron）

`vercel.json` に登録済みです（時刻は UTC。Hobby プランは1日1回まで）。

| パス | 時刻（日本時間） | 内容 |
| --- | --- | --- |
| `/api/cron/notifications` | 毎日 8:00 | 前日・当日リマインドの作成と、未送信の通知の送信 |
| `/api/cron/cleanup` | 毎日 3:00 | 期限切れのデモ環境・セッション・回数制限の記録の削除、見本の企業の作り直し |

## 補足

- ブラウザから Supabase の Data API（PostgREST）は使いません。Supabase の Project Settings → Data API で無効にしておくと、公開される入口を減らせます。
- Supabase 以外の PostgreSQL（Neon など）でも動きます。auth スキーマが無い DB では、ビルド時に Supabase の土台（`db/local/supabase-shim.sql`）を先に作ります。接続する利用者には BYPASSRLS が必要です。
  管理者権限のない利用者（DB の所有者＋BYPASSRLS）での初回構築・2回目のビルド・E2E 全件は、ローカルの別クラスタで確認済みです。
- Vercel Hobby は非商用の利用に限られます。営業用途で使う場合は Pro プランを検討してください。
