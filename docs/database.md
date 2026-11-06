# データベース設計

PostgreSQL（Supabase）。マイグレーションは `supabase/migrations/`（Supabase CLI と同じ形式）。
ローカル・CI では `db/local/supabase-shim.sql` で Supabase の土台（ロール・auth スキーマ）を再現してから適用します。

## 共通の約束

| 項目 | 内容 |
| --- | --- |
| 主キー | UUID（`gen_random_uuid()`） |
| テナント | テナントのデータはすべて `organization_id` を持つ |
| テナントをまたぐ参照の防止 | 親テーブルに `unique (organization_id, id)` を置き、子は `(organization_id, 親id)` の複合外部キーで参照する。別企業のスタッフ・顧客・サービスを指す行は DB が拒否する |
| 日時 | `timestamptz`（UTC）。店舗の `timezone` で表示・計算する。営業時間・勤務時間は `time`（店舗の現地時刻） |
| 金額 | 円の整数（`integer`、最小通貨単位） |
| 作成・更新日時 | `created_at` / `updated_at`（更新はトリガー） |
| 削除 | 予約が参照する顧客・サービス・スタッフ・設備は削除できない（外部キー）。使わなくなったものは `is_active = false` |

## テーブル

```
organizations ─┬─ locations ─┬─ tenant_settings（1:1）
               │             ├─ business_hours / business_hour_exceptions
               │             ├─ staff ─┬─ staff_schedules / staff_time_off
               │             │         └─ service_staff ─┐
               │             ├─ services ────────────────┤
               │             │         └─ service_resources ─ resources
               │             └─ bookings ─┬─ booking_resources
               │                          ├─ booking_status_history
               │                          └─ notification_events ─ notification_deliveries
               ├─ organization_members（auth.users と結ぶ。staff.member_id で担当者と結ぶ）
               ├─ customers ─ customer_notes
               └─ audit_logs
```

| テーブル | 役割 | 主な列 |
| --- | --- | --- |
| organizations | 企業（契約の単位） | name, is_demo, is_showcase, demo_session_id, demo_expires_at |
| locations | 店舗 | slug（公開予約 URL `/book/{slug}`）, industry, phone, email, address, logo_url, timezone |
| tenant_settings | 店舗の予約受付設定 | staff_selection（required/optional/none）, slot_interval_minutes, min_lead_minutes, max_advance_days, cancel_deadline_hours, cancellation_policy, 顧客区分の条件, 空き枠提案の重み, リマインド |
| business_hours | 曜日ごとの営業時間（行が無い曜日は定休日。1日に複数行で中休み） | weekday, opens_at, closes_at（同じ曜日の重なりは排他制約で拒否） |
| business_hour_exceptions | 特定日の休業・営業時間の変更 | date, is_closed, opens_at, closes_at |
| organization_members | ログインと役割 | user_id → auth.users, role（owner/manager/staff）, display_name, is_active |
| staff | 担当者 | location_id, member_id（任意）, name, title, color, is_active |
| staff_schedules | 曜日ごとの基本勤務 | weekday, starts_at, ends_at, break_starts_at, break_ends_at |
| staff_time_off | 特定日の休暇・勤務時間の変更 | date, kind（day_off/custom_hours）, starts_at, ends_at |
| services | メニュー | price, duration_minutes, buffer_before/after_minutes, category, is_public, is_active |
| service_staff | サービスに対応するスタッフ | |
| resources | 設備（部屋・ベッド・ブース） | kind（room/equipment/seat） |
| service_resources | サービスに必要な設備（登録したうち**どれか1つ**が空いていればよい） | |
| customers | 顧客（企業単位。同じ企業の店舗で共有） | name, name_kana, phone, email, preferred_staff_id（担当）, source |
| customer_notes | 顧客メモ | author_member_id, body |
| bookings | 予約 | starts_at, ends_at, buffer_*（予約時点の値）, occupied（占有時間）, price, status, notes, customer_message, source, manage_token_hash, version |
| booking_resources | 予約が使う設備 | occupied, is_active（予約から自動で同期） |
| booking_status_history | ステータスの変更履歴 | from_status, to_status, changed_by, source, reason |
| notification_events | 通知の出来事 | type, dedupe_key（一意＝重複しない）, payload |
| notification_deliveries | 送信の状態 | channel, recipient, status（pending/sent/demo/skipped/failed）, attempts |
| audit_logs | 操作履歴 | actor_user_id, action, target_type, target_id, details |
| app_private.sessions | ログインのセッション（Cookie の SHA-256 のみ） | |
| app_private.demo_sessions | デモ訪問者（利用者3人と企業4社をまとめる） | |
| app_private.rate_limits | 回数の制限 | bucket, created_at |

## 予約ステータスと枠の占有

| ステータス | 意味 | 枠を占有 |
| --- | --- | --- |
| confirmed | 予約確定 | する |
| checked_in | 来店済み | する |
| completed | サービス完了 | する |
| cancelled_customer | 顧客キャンセル | しない |
| cancelled_store | 店舗キャンセル | しない |
| no_show | 無断キャンセル | しない |

占有時間 `occupied = [開始 − 前バッファ, 終了 + 後バッファ)`（半開区間なので、終了ちょうどに次の予約を始められる）。
`booking_blocks_slot(status)` が占有の判定で、排他制約・空き枠計算で同じ定義を使います。

## 競合の防止（DB 側）

```sql
-- 同じスタッフの占有時間は重ならない
exclude using gist (staff_id with =, occupied with &&)
  where (staff_id is not null and status in ('confirmed', 'checked_in', 'completed'))
-- 同じ設備の占有時間は重ならない
exclude using gist (resource_id with =, occupied with &&) where (is_active)
```

- 2つのトランザクションが同時に同じ枠を取ろうとしても、片方は `23P01`（exclusion_violation）で失敗します（`tests/db/booking-conflict.test.ts`）。
- 予約の時間・ステータスが変わると、トリガーが占有時間と設備の占有を同期します。キャンセルした予約を元に戻すとき、枠が埋まっていれば拒否されます。
- アプリはこのエラーを「同じ時間にこのスタッフの予約がすでに入っています」などの文に置き換えます（`src/lib/actions/result.ts`）。

## RLS（`20261105000002_rls.sql`）

| データ | owner | manager | staff | anon |
| --- | --- | --- | --- | --- |
| 企業・店舗・店舗設定・営業時間 | 読み書き | 読む | 読む | × |
| サービス・設備・スタッフ（登録） | 読み書き | 読む | 読む | × |
| スタッフの勤務・休暇 | 読み書き | 読み書き | 読む | × |
| 顧客 | 読み書き | 読み書き | 担当した顧客を読む | × |
| 顧客メモ | 読み書き | 読み書き | 担当した顧客の分を読み書き | × |
| 予約・設備の割り当て・履歴 | 読む（書き込みは DB 関数） | 読む（同左） | 自分の担当を読む | × |
| 通知 | 読む | 読む | × | × |
| 操作履歴 | 読む | × | × | × |

- 判定関数（`app_private.member_role` など）は security definer で、`auth.uid()` の所属だけを見ます。
- Supabase の既定（public の全テーブルに anon・authenticated の全権限）を外してから、必要な権限だけを付け直しています。
- `app_private` スキーマ（セッション・デモ訪問者・回数制限）はログイン利用者からも読めません。
- 確認は `tests/db/rls.test.ts`（テナント分離・役割ごとの読み書き・anon の拒否）。

## インデックス

| 用途 | インデックス |
| --- | --- |
| カレンダー（店舗・期間） | bookings (location_id, starts_at) |
| スタッフの予定 | bookings (staff_id, starts_at) |
| 顧客の予約履歴 | bookings (customer_id, starts_at desc) |
| 分析（企業・ステータス・期間） | bookings (organization_id, status, starts_at) |
| 顧客検索（氏名・カナ・電話・メールの部分一致） | customers GIN (pg_trgm) |
| 重なりの判定 | 排他制約の GiST |
