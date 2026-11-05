-- ReserveFlow：テーブル・制約・インデックス
--
-- 方針
--   * 主キーは UUID。すべてのテナントデータは organization_id を持つ
--   * テナントをまたぐ参照を防ぐため、子テーブルは (organization_id, 親id) の複合外部キーで親を参照する
--     （別の企業のスタッフ・顧客・サービスを指す行は DB が拒否する）
--   * 金額は円の整数（最小通貨単位）、時刻は timestamptz（UTC）で保存し、店舗のタイムゾーンで表示する
--   * 予約がスタッフ・設備を占有する時間 = [開始 - 前バッファ, 終了 + 後バッファ)
--     枠を占有するのは「予約確定・来店済み・サービス完了」。キャンセル系・無断キャンセルは占有しない
--   * 同じスタッフ・設備の占有時間の重なりは排他制約（EXCLUDE USING gist）で DB が拒否する

create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists app_private;
revoke all on schema app_private from public;

-- ---------------------------------------------------------------
-- 共通：更新日時
-- ---------------------------------------------------------------
create or replace function app_private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------
-- 型（列の値の候補）
-- ---------------------------------------------------------------
create type public.member_role as enum ('owner', 'manager', 'staff');
create type public.booking_status as enum (
  'confirmed',          -- 予約確定
  'checked_in',         -- 来店済み
  'completed',          -- サービス完了
  'cancelled_customer', -- 顧客キャンセル
  'cancelled_store',    -- 店舗キャンセル
  'no_show'             -- 無断キャンセル
);
create type public.booking_source as enum ('admin', 'public', 'demo');
create type public.staff_selection as enum ('required', 'optional', 'none');
create type public.notification_type as enum (
  'booking_confirmed', 'booking_changed', 'booking_cancelled', 'reminder_day_before', 'reminder_same_day'
);
create type public.delivery_status as enum ('pending', 'sent', 'demo', 'skipped', 'failed');

-- 予約が枠を占有するか（排他制約・空き枠計算で共通に使う）
create or replace function public.booking_blocks_slot(s public.booking_status) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select s in ('confirmed', 'checked_in', 'completed')
$$;

-- ---------------------------------------------------------------
-- 企業・店舗
-- ---------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  is_demo boolean not null default false,
  -- 見本の企業（公開予約ページ /book/demo-salon などの見本。毎日作り直す）
  is_showcase boolean not null default false,
  demo_session_id uuid,               -- デモ訪問者ごとの企業（app_private.demo_sessions）
  demo_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((is_demo and demo_expires_at is not null and not is_showcase) or (not is_demo and demo_session_id is null))
);
create index organizations_demo_idx on public.organizations (demo_session_id) where is_demo;
create index organizations_demo_expires_idx on public.organizations (demo_expires_at) where is_demo;

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$'),
  industry text not null check (industry in ('beauty_salon', 'nail_salon', 'chiropractic', 'personal_gym', 'school', 'rental_space', 'other')),
  logo_url text check (logo_url is null or logo_url ~ '^https://'),
  phone text check (phone is null or phone ~ '^[0-9+() -]{6,20}$'),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address text check (address is null or char_length(address) <= 200),
  timezone text not null default 'Asia/Tokyo',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create index locations_org_idx on public.locations (organization_id);

-- 予約受付・キャンセル・顧客区分・空き枠提案の重みなど（店舗ごと）
create table public.tenant_settings (
  location_id uuid primary key,
  organization_id uuid not null,
  currency text not null default 'JPY' check (currency = 'JPY'),
  public_booking_enabled boolean not null default true,
  staff_selection public.staff_selection not null default 'optional',
  slot_interval_minutes integer not null default 30 check (slot_interval_minutes in (10, 15, 20, 30, 60)),
  min_lead_minutes integer not null default 60 check (min_lead_minutes between 0 and 10080),
  max_advance_days integer not null default 60 check (max_advance_days between 1 and 365),
  cancel_deadline_hours integer not null default 24 check (cancel_deadline_hours between 0 and 720),
  cancellation_policy text not null default '' check (char_length(cancellation_policy) <= 2000),
  -- 顧客区分（新規・リピーター・優良・休眠）の条件
  segment_repeat_min_visits integer not null default 2 check (segment_repeat_min_visits >= 2),
  segment_vip_min_visits integer not null default 6 check (segment_vip_min_visits >= 2),
  segment_vip_min_spend integer not null default 50000 check (segment_vip_min_spend >= 0),
  segment_dormant_days integer not null default 90 check (segment_dormant_days between 14 and 730),
  -- スマート空き枠提案の重み（0〜100）
  weight_preferred_time integer not null default 40 check (weight_preferred_time between 0 and 100),
  weight_gap integer not null default 30 check (weight_gap between 0 and 100),
  weight_balance integer not null default 20 check (weight_balance between 0 and 100),
  weight_idle integer not null default 10 check (weight_idle between 0 and 100),
  -- リマインド
  remind_day_before boolean not null default true,
  remind_same_day boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations (organization_id, id) on delete cascade
);

-- 曜日ごとの営業時間（行が無い曜日は定休日。1日に複数行で中休みも表せる）
create table public.business_hours (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6), -- 0=日曜
  opens_at time not null,
  closes_at time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (opens_at < closes_at),
  foreign key (organization_id, location_id) references public.locations (organization_id, id) on delete cascade,
  exclude using gist (location_id with =, weekday with =, tsrange(('2000-01-01'::date + opens_at), ('2000-01-01'::date + closes_at)) with &&)
);
create index business_hours_location_idx on public.business_hours (location_id, weekday);

-- 特定日の休業・営業時間の変更（祝日・臨時休業・特別営業）
create table public.business_hour_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  date date not null,
  is_closed boolean not null default true,
  opens_at time,
  closes_at time,
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (is_closed or (opens_at is not null and closes_at is not null and opens_at < closes_at)),
  unique (location_id, date),
  foreign key (organization_id, location_id) references public.locations (organization_id, id) on delete cascade
);

-- ---------------------------------------------------------------
-- メンバー（ログインと権限）・スタッフ
-- ---------------------------------------------------------------
create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  display_name text not null check (char_length(display_name) between 1 and 60),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (organization_id, id)
);
create index organization_members_user_idx on public.organization_members (user_id) where is_active;

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  member_id uuid,                 -- ログインできるスタッフはメンバーと結び付ける（任意）
  name text not null check (char_length(name) between 1 and 60),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  title text check (title is null or char_length(title) <= 40), -- 「スタイリスト」「トレーナー」など業種ごとの呼び方
  color text not null default '#3b82f6' check (color ~ '^#[0-9a-fA-F]{6}$'),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (location_id, member_id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id) on delete cascade,
  foreign key (organization_id, member_id) references public.organization_members (organization_id, id) on delete set null (member_id)
);
create index staff_location_idx on public.staff (location_id) where is_active;

-- 曜日ごとの基本勤務（行が無い曜日は休み）
create table public.staff_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  staff_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  break_starts_at time,
  break_ends_at time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at),
  check ((break_starts_at is null) = (break_ends_at is null)),
  check (break_starts_at is null or (starts_at <= break_starts_at and break_starts_at < break_ends_at and break_ends_at <= ends_at)),
  unique (staff_id, weekday),
  foreign key (organization_id, staff_id) references public.staff (organization_id, id) on delete cascade
);

-- 特定日の休暇・勤務時間の変更
create table public.staff_time_off (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  staff_id uuid not null,
  date date not null,
  kind text not null check (kind in ('day_off', 'custom_hours')),
  starts_at time,
  ends_at time,
  reason text check (reason is null or char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'day_off' and starts_at is null and ends_at is null)
      or (kind = 'custom_hours' and starts_at is not null and ends_at is not null and starts_at < ends_at)),
  unique (staff_id, date),
  foreign key (organization_id, staff_id) references public.staff (organization_id, id) on delete cascade
);

-- ---------------------------------------------------------------
-- サービス・設備
-- ---------------------------------------------------------------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  category text check (category is null or char_length(category) <= 40),
  description text check (description is null or char_length(description) <= 1000),
  price integer not null check (price between 0 and 10000000),
  duration_minutes integer not null check (duration_minutes between 5 and 720 and duration_minutes % 5 = 0),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 120),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes between 0 and 120),
  color text not null default '#3b82f6' check (color ~ '^#[0-9a-fA-F]{6}$'),
  is_public boolean not null default true,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id) on delete cascade
);
create index services_location_idx on public.services (location_id) where is_active;

create table public.service_staff (
  organization_id uuid not null,
  service_id uuid not null,
  staff_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (service_id, staff_id),
  foreign key (organization_id, service_id) references public.services (organization_id, id) on delete cascade,
  foreign key (organization_id, staff_id) references public.staff (organization_id, id) on delete cascade
);
create index service_staff_staff_idx on public.service_staff (staff_id);

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  name text not null check (char_length(name) between 1 and 60),
  kind text not null default 'equipment' check (kind in ('room', 'equipment', 'seat')),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id) on delete cascade
);

-- サービスに必要な設備（登録した設備のうち「どれか1つ」が空いていれば予約できる）
create table public.service_resources (
  organization_id uuid not null,
  service_id uuid not null,
  resource_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (service_id, resource_id),
  foreign key (organization_id, service_id) references public.services (organization_id, id) on delete cascade,
  foreign key (organization_id, resource_id) references public.resources (organization_id, id) on delete cascade
);

-- ---------------------------------------------------------------
-- 顧客
-- ---------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  name_kana text check (name_kana is null or char_length(name_kana) <= 60),
  phone text check (phone is null or phone ~ '^[0-9+() -]{6,20}$'),
  email text check (email is null or (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  preferred_staff_id uuid,       -- 担当スタッフ
  source public.booking_source not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, preferred_staff_id) references public.staff (organization_id, id) on delete set null (preferred_staff_id)
);
create index customers_org_idx on public.customers (organization_id, created_at desc);
create index customers_search_idx on public.customers using gin ((name || ' ' || coalesce(name_kana, '') || ' ' || coalesce(phone, '') || ' ' || coalesce(email, '')) extensions.gin_trgm_ops);
create index customers_email_idx on public.customers (organization_id, lower(email)) where email is not null;

create table public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  author_member_id uuid,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id) on delete cascade,
  foreign key (organization_id, author_member_id) references public.organization_members (organization_id, id) on delete set null (author_member_id)
);
create index customer_notes_customer_idx on public.customer_notes (customer_id, created_at desc);

-- ---------------------------------------------------------------
-- 予約
-- ---------------------------------------------------------------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  customer_id uuid not null,
  service_id uuid not null,
  staff_id uuid,                                  -- 担当者のいない業種（レンタルスペースなど）では空
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 120),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes between 0 and 120),
  -- 占有時間（トリガーで設定）：[開始 - 前バッファ, 終了 + 後バッファ)
  occupied tstzrange not null,
  price integer not null check (price between 0 and 10000000),
  status public.booking_status not null default 'confirmed',
  notes text check (notes is null or char_length(notes) <= 1000),           -- 店舗の備考
  customer_message text check (customer_message is null or char_length(customer_message) <= 500), -- お客様からの要望
  source public.booking_source not null default 'admin',
  manage_token_hash text unique,                  -- 公開ページからの変更・キャンセル用（SHA-256 のみ保存）
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  version integer not null default 1,             -- 同時編集の検出（楽観ロック）
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at),
  check (ends_at - starts_at <= interval '12 hours'),
  unique (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id) on delete cascade,
  foreign key (organization_id, customer_id) references public.customers (organization_id, id),
  foreign key (organization_id, service_id) references public.services (organization_id, id),
  foreign key (organization_id, staff_id) references public.staff (organization_id, id),
  -- 同じスタッフの占有時間は重ならない（枠を占有するステータスだけ）
  constraint bookings_no_staff_overlap exclude using gist (
    staff_id with =, occupied with &&
  ) where (staff_id is not null and status in ('confirmed', 'checked_in', 'completed'))
);
create index bookings_location_time_idx on public.bookings (location_id, starts_at);
create index bookings_staff_time_idx on public.bookings (staff_id, starts_at) where staff_id is not null;
create index bookings_customer_idx on public.bookings (customer_id, starts_at desc);
create index bookings_org_status_idx on public.bookings (organization_id, status, starts_at);

create or replace function app_private.set_booking_occupied() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.occupied := tstzrange(
    new.starts_at - make_interval(mins => new.buffer_before_minutes),
    new.ends_at + make_interval(mins => new.buffer_after_minutes),
    '[)'
  );
  return new;
end $$;
create trigger bookings_occupied before insert or update of starts_at, ends_at, buffer_before_minutes, buffer_after_minutes
  on public.bookings for each row execute function app_private.set_booking_occupied();

-- 予約が使う設備（占有時間と有効フラグは予約から写す）
create table public.booking_resources (
  organization_id uuid not null,
  booking_id uuid not null,
  resource_id uuid not null,
  occupied tstzrange not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (booking_id, resource_id),
  foreign key (organization_id, booking_id) references public.bookings (organization_id, id) on delete cascade,
  foreign key (organization_id, resource_id) references public.resources (organization_id, id),
  constraint booking_resources_no_overlap exclude using gist (
    resource_id with =, occupied with &&
  ) where (is_active)
);
create index booking_resources_resource_idx on public.booking_resources (resource_id);

-- 予約の時間・ステータスが変わったら、設備の占有も合わせる
create or replace function app_private.sync_booking_resources() returns trigger
language plpgsql set search_path = '' as $$
begin
  update public.booking_resources
     set occupied = new.occupied, is_active = public.booking_blocks_slot(new.status)
   where booking_id = new.id
     and (occupied is distinct from new.occupied or is_active is distinct from public.booking_blocks_slot(new.status));
  return null;
end $$;
-- occupied は BEFORE トリガーが設定するため「update of 列」ではなく、値の変化で判定する
create trigger bookings_sync_resources after update on public.bookings
  for each row when (old.occupied is distinct from new.occupied or old.status is distinct from new.status)
  execute function app_private.sync_booking_resources();

create table public.booking_status_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  booking_id uuid not null,
  from_status public.booking_status,               -- 作成時は空
  to_status public.booking_status not null,
  changed_by uuid references auth.users (id) on delete set null,
  source public.booking_source not null default 'admin',
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  foreign key (organization_id, booking_id) references public.bookings (organization_id, id) on delete cascade
);
create index booking_status_history_booking_idx on public.booking_status_history (booking_id, created_at);

-- ---------------------------------------------------------------
-- 通知
-- ---------------------------------------------------------------
create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  booking_id uuid,
  type public.notification_type not null,
  dedupe_key text not null unique,                 -- 同じ出来事の通知を2回作らない
  payload jsonb not null default '{}'::jsonb,      -- 作成時点の予約内容（通知文の材料）
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id) on delete cascade,
  foreign key (organization_id, booking_id) references public.bookings (organization_id, id) on delete cascade
);
create index notification_events_location_idx on public.notification_events (location_id, created_at desc);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  event_id uuid not null,
  channel text not null default 'email' check (channel in ('email')),
  recipient text,
  status public.delivery_status not null default 'pending',
  provider text,
  subject text,
  body text,
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, channel),                      -- 1つの出来事・送信手段につき1件
  foreign key (organization_id, event_id) references public.notification_events (organization_id, id) on delete cascade
);
create index notification_deliveries_pending_idx on public.notification_deliveries (status, created_at) where status = 'pending';

-- ---------------------------------------------------------------
-- 操作履歴
-- ---------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_org_idx on public.audit_logs (organization_id, created_at desc);

-- ---------------------------------------------------------------
-- アプリ内部（ブラウザ・ログイン利用者からは読めない）
-- ---------------------------------------------------------------
-- ログインのセッション（AUTH_PROVIDER=local と、デモ利用者）。Cookie の値の SHA-256 だけを保存する
create table app_private.sessions (
  token_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user_idx on app_private.sessions (user_id);
create index sessions_expires_idx on app_private.sessions (expires_at);

-- デモの訪問者（1訪問者 = 企業4社 + オーナー・マネージャー・スタッフの3利用者）
create table app_private.demo_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  manager_user_id uuid not null references auth.users (id) on delete cascade,
  staff_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- デモ訪問者を消すと、その企業もまとめて消える
alter table public.organizations add foreign key (demo_session_id) references app_private.demo_sessions (id) on delete cascade;

-- 企業を削除する（デモ・見本の作り直し）。予約は顧客・サービス・設備を参照し、それらの削除を止めるので先に消す
create or replace function app_private.delete_organizations(p_ids uuid[]) returns integer
language plpgsql set search_path = '' as $$
declare v_count integer;
begin
  delete from public.bookings where organization_id = any (p_ids);
  delete from public.organizations where id = any (p_ids);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- 回数の制限（ログイン失敗・公開 API・デモ作成）
create table app_private.rate_limits (
  id bigint generated always as identity primary key,
  bucket text not null,
  created_at timestamptz not null default now()
);
create index rate_limits_bucket_idx on app_private.rate_limits (bucket, created_at);

-- ---------------------------------------------------------------
-- 更新日時のトリガー
-- ---------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['organizations', 'locations', 'tenant_settings', 'business_hours', 'business_hour_exceptions',
    'organization_members', 'staff', 'staff_schedules', 'staff_time_off', 'services', 'resources', 'customers',
    'customer_notes', 'bookings', 'notification_deliveries']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function app_private.touch_updated_at()', t || '_touch', t);
  end loop;
end $$;
