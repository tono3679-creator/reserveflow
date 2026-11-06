# ReserveFlow

**予約管理をシンプルに。店舗経営をスマートに。**

美容室・ネイルサロン・整体院・パーソナルジム・個人スクール・レンタルスペースなど、複数の業種で使えるクラウド型の予約・顧客管理システムです。
業種の違いは設定とデータで表し、同じ仕組みでさまざまなお店に導入できる設計にしています。

> Phase 1〜6 の実装が完了しています。公開（Vercel）は、アカウントと環境変数の登録が済みしだい行います（[docs/deployment.md](docs/deployment.md)）。

## 主な機能

| 機能 | 内容 |
| --- | --- |
| マルチテナント | 企業と店舗を分け、データは RLS で企業ごとに分離。所属する店舗の切り替え |
| 権限 | オーナー・マネージャー・スタッフ。画面・サーバー・DB（RLS）の3段で判定 |
| 予約カレンダー・予約管理 | 月・週・日・スタッフ別の表示、カレンダーから直接登録、ドラッグで日時・担当を変更、ステータス管理と変更履歴 |
| 予約の競合防止 | 同じスタッフ・設備の時間（前後の準備時間を含む）の重なりを DB の排他制約で拒否。同時予約・同時更新にも対応 |
| 顧客管理 | 検索・絞り込み・並べ替え、来店統計、顧客区分（新規・リピーター・VIP・休眠。基準は設定可能）、メモ |
| スタッフ・サービス管理 | 勤務スケジュール・休憩・休暇・勤務変更、担当サービス、必要な設備、前後のバッファ時間、スタッフ別の実績 |
| 公開予約ページ | `/book/[slug]`。スマートフォン向けの8ステップ、予約の確認・変更・キャンセル（推測できないトークン）、レート制限 |
| 通知 | 確定・変更・キャンセル・前日／当日リマインドの記録と送信状態、重複送信の防止。メールの API キーがなければデモ表示 |
| ダッシュボード | KPI 8種（前期間との比較）、グラフ6種、本日の予約、実データの基準を満たしたときだけ出すインサイト |
| 分析 | 売上分析、無断キャンセル分析（母数と期間を明記、推定機会損失）、リピート率分析（30・60・90日コホート）、スタッフ別 |
| スマート空き枠提案 | 10の判定条件を満たす枠を探し、4項目の重み付きスコアでランキング。計算値から作るおすすめ理由、候補から予約登録 |
| デモ | 登録なしで訪問者専用の4業種の店舗を生成。立場の切り替え・初期化・24時間で自動削除。公開予約の見本は毎日作り直す |

すべての数値・インサイト・おすすめ理由は、実際の予約データから計算しています。AI API は使っていません。

## 完成条件の確認

| 条件 | 確認方法 |
| --- | --- |
| 予約の作成・変更・キャンセルができる | `tests/db/booking-functions.test.ts`、`tests/e2e/bookings.spec.ts` |
| 同時予約による競合を防げる | `tests/db/booking-conflict.test.ts`（同時に2件登録しても1件だけ成功） |
| 顧客・スタッフ・サービスを管理できる | `tests/e2e/bookings.spec.ts`、`tests/db/customer-segments.test.ts` |
| 公開予約ページから予約できる | `tests/db/public-booking.test.ts`、`tests/e2e/public-booking.spec.ts` |
| 売上・予約 KPI を確認できる | `tests/db/analytics.test.ts`、`tests/e2e/analytics.spec.ts` |
| 無断キャンセル率・リピート率を正しく算出できる | `tests/db/analytics.test.ts`（手計算できる小さなデータで検証） |
| スマート空き枠提案が動作する | `tests/unit/suggestions.test.ts`、`tests/e2e/suggestions.spec.ts` |
| 複数業種のデモを切り替えられる | `tests/e2e/foundation.spec.ts` |
| テナント間のデータが分離されている | `tests/db/rls.test.ts` |
| PC・スマートフォンで利用できる | 全画面を幅 390px で横にはみ出さないことを確認、`tests/e2e/*`（スマートフォンでの予約とメニュー） |
| デモ環境を安全に利用できる | 訪問者ごとの企業、RLS、作成回数の上限、24時間で削除、見本の毎日の作り直し（`tests/db/showcase.test.ts`） |
| ビルド・主要テストが成功する | GitHub Actions（`.github/workflows/ci.yml`） |

## 技術構成

Next.js 16（App Router）／TypeScript（strict）／Tailwind CSS 4／shadcn/ui 形式の UI 部品（Radix UI）／Lucide React／
Supabase（PostgreSQL・Auth）／FullCalendar／Recharts／React Hook Form／Zod／date-fns／Vercel

設計の詳細は次のドキュメントにあります。

- [docs/architecture.md](docs/architecture.md) … 要件の整理、構成、認証・RLS・デモ・空き枠エンジンの仕組み
- [docs/database.md](docs/database.md) … テーブル、競合防止、RLS の権限表
- [docs/features.md](docs/features.md) … 画面とルーティング、各 Phase で実装したもの、指標の定義
- [docs/demo.md](docs/demo.md) … デモの使い方とデータの内容
- [docs/deployment.md](docs/deployment.md) … 公開手順（Vercel ＋ Supabase）

## セットアップ（ローカル）

必要なもの：Node.js 22、PostgreSQL 16

```bash
npm install
cp .env.example .env.local          # DATABASE_URL などを設定
npm run db:local:reset              # DB を作り直し、Supabase の土台を再現してマイグレーションを適用
SEED_LOGIN_PASSWORD=任意の12文字以上 npm run db:seed   # 見本の企業（4業種）を作成
npm run dev                         # http://localhost:3000
```

## デモの使い方

1. トップページで業種を選び「〜で試す」を押す（登録不要）。その訪問者専用の4業種の店舗が、今日を基準に作られます。
2. ヘッダーの店舗名から業種（店舗）を切り替えられます。
3. 右上のメニューから、オーナー／マネージャー／スタッフの立場を切り替えると、見える画面とデータが変わります。
4. 「デモデータを初期化」で自分の環境だけを作り直し、「デモを終了する」で自分のデータをすべて削除します。

公開予約ページの見本は `/book/demo-salon`（美容室）・`/book/demo-seitai`（整体院）・`/book/demo-gym`（パーソナルジム）・`/book/demo-space`（レンタルスペース）です。
見本の企業には `owner@reserveflow.example`（パスワードは `SEED_LOGIN_PASSWORD`）でもログインできます。詳しくは [docs/demo.md](docs/demo.md)。

## テスト

```bash
npm test             # ユニットテストと DB のテスト（テスト用 DB reserveflow_test を自動で作り直す）
npm run test:e2e     # ブラウザでの E2E（Playwright）
npm run lint && npm run typecheck && npm run build
```

| テスト | 内容 |
| --- | --- |
| tests/unit/scheduling.test.ts | スタッフの勤務時間・休憩・休暇・営業時間・設備・受付期限の判定、空き枠の列挙 |
| tests/unit/suggestions.test.ts | 空き枠提案の探索・スコアリング（希望時刻・隙間・平準化・未利用時間）・重み・理由 |
| tests/unit/analytics.test.ts | 期間と前期間、率と比較、稼働率、空き時間、インサイトの基準 |
| tests/db/booking-functions.test.ts | 予約の登録・変更・ステータス遷移・履歴・権限 |
| tests/db/booking-conflict.test.ts | 同じスタッフ・設備の重複、バッファ時間、キャンセルの扱い、同時予約 |
| tests/db/analytics.test.ts | 売上・無断キャンセル率・リピート率・コホートを手計算と照合、スタッフの立場での集計範囲 |
| tests/db/rls.test.ts | テナント間のアクセス制限、役割ごとの読み書き、未ログインの拒否 |
| tests/db/public-booking.test.ts | 公開予約の空き枠・確定・変更・キャンセル、トークン、通知の重複防止 |
| tests/e2e/*.spec.ts | デモ・権限・予約・公開予約・分析・空き枠提案の画面操作（PC とスマートフォン） |

公開後は GitHub Actions の「Production E2E」（`.github/workflows/production-e2e.yml`）で、公開 URL に対して同じ E2E を実行できます。

## 対象外・未確認のこと

- 実際のメール送信（Resend）は、API キーがないため未確認です（通知はデモ表示で確認）。
- Supabase Auth（`AUTH_PROVIDER=supabase`）での実ログインは、作業環境から Supabase に接続できないため未確認です。既定はアプリ内のログイン（`local`）です。
- リマインドの定期処理は1日1回です（Vercel Hobby の制限）。
- 分析の CSV 出力、複数店舗をまとめた集計、公開予約ページでのおすすめ枠の表示、AI による自然言語の提案は対象外です。

## ライセンス・データ

ポートフォリオ作品です。掲載している店舗・人物・予約・連絡先はすべて架空のデータです。
