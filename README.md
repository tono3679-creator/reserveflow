# ReserveFlow

**予約管理をシンプルに。店舗経営をスマートに。**

美容室・ネイルサロン・整体院・パーソナルジム・個人スクール・レンタルスペースなど、複数の業種で使えるクラウド型の予約・顧客管理システムです。
業種の違いは設定とデータで表し、同じ仕組みでさまざまなお店に導入できる設計にしています。

> 開発中（Phase 4：分析機能まで完了）。進み具合は [docs/features.md](docs/features.md) を参照してください。

## 主な機能

| 機能 | 内容 | 状態 |
| --- | --- | --- |
| マルチテナント | 企業と店舗を分け、データは RLS で企業ごとに分離。店舗の切り替え | ✅ |
| 権限 | オーナー・マネージャー・スタッフ。画面・サーバー・DB（RLS）の3段で判定 | ✅ |
| デモ | 登録なしで訪問者専用の4業種の店舗を生成。立場の切り替え・初期化 | ✅ |
| 店舗設定 | 店舗情報・営業時間・定休日・予約受付とキャンセルのルール | ✅ |
| 予約の競合防止 | 同じスタッフ・設備の時間の重なりを DB の排他制約で拒否（同時予約も） | ✅（DB） |
| 予約カレンダー・予約管理 | 月・週・日・スタッフ別、ドラッグで変更 | Phase 2 |
| 顧客・スタッフ・サービス管理 | 検索・絞り込み、勤務スケジュール、担当サービス・設備 | Phase 2 |
| 公開予約ページ | スマートフォン向けの予約・変更・キャンセル（推測できないトークン） | Phase 3 |
| 分析 | KPI・売上・無断キャンセル・リピート率（コホート）・スタッフ別 | Phase 4 |
| スマート空き枠提案 | ルールベースの探索とスコアリング、おすすめ理由 | Phase 5 |

## 技術構成

Next.js 16（App Router）／TypeScript（strict）／Tailwind CSS 4／shadcn/ui 形式の UI 部品（Radix UI）／Lucide React／
Supabase（PostgreSQL・Auth）／FullCalendar／Recharts／React Hook Form／Zod／date-fns／Vercel

設計の詳細は次のドキュメントにあります。

- [docs/architecture.md](docs/architecture.md) … 要件の整理、構成、認証・RLS・デモの仕組み、開発計画
- [docs/database.md](docs/database.md) … テーブル、競合防止、RLS の権限表
- [docs/features.md](docs/features.md) … 画面とルーティング、実装状況
- [docs/demo.md](docs/demo.md) … デモの使い方とデータの内容
- [docs/deployment.md](docs/deployment.md) … 公開手順

## セットアップ（ローカル）

必要なもの：Node.js 22、PostgreSQL 16

```bash
npm install
cp .env.example .env.local          # DATABASE_URL などを設定
npm run db:local:reset              # DB を作り直し、Supabase の土台を再現してマイグレーションを適用
SEED_LOGIN_PASSWORD=任意の12文字以上 npm run db:seed   # 見本の企業（4業種）を作成
npm run dev                         # http://localhost:3000
```

トップページの「デモを試す」で、登録なしですべての機能を試せます。見本の企業には `owner@reserveflow.example`（パスワードは `SEED_LOGIN_PASSWORD`）でログインできます。

## テスト

```bash
npm test             # ユニットテストと DB のテスト（テスト用 DB reserveflow_test を自動で作り直す）
npm run test:e2e     # ブラウザでの E2E（Playwright）
npm run lint && npm run typecheck && npm run build
```

| テスト | 内容 |
| --- | --- |
| tests/db/rls.test.ts | テナント間のアクセス制限、役割ごとの読み書き、未ログインの拒否 |
| tests/db/booking-conflict.test.ts | 同じスタッフ・設備の重複、バッファ時間、キャンセルの扱い、同時予約 |
| tests/unit/demo-data.test.ts | デモデータの件数・期間・重なりのなさ・新規とリピーターの混在 |
| tests/e2e/foundation.spec.ts | デモ開始・店舗切り替え・店舗設定の保存・権限による画面の制限・スマートフォンのドロワー |

## ライセンス・データ

ポートフォリオ作品です。掲載している店舗・人物・予約・連絡先はすべて架空のデータです。
