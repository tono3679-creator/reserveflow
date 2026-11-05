-- ローカル PostgreSQL（開発・テスト・CI）で、Supabase が最初から用意している土台を再現する。
-- 本番の Supabase には適用しない（Supabase には同じものが既にある）。何度実行しても同じ結果になる。
--
--   * ロール：anon（未ログイン）、authenticated（ログイン中）、service_role（管理処理）
--   * auth スキーマ：auth.users と、JWT の内容を読む auth.uid() / auth.jwt() / auth.role()
--   * extensions スキーマ
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
-- 接続ユーザー（Supabase の postgres に相当）が、トランザクションの中でこれらのロールに切り替えられるようにする
grant anon, authenticated, service_role to current_user;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase と同じく、public に作る表・関数には既定で権限が付く（マイグレーション側で必要な分だけに締め直す）
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

-- Supabase の auth.users のうち、このアプリが使う列だけ（列名・型は Supabase と同じ）
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  aud varchar(255) default 'authenticated',
  role varchar(255) default 'authenticated',
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  is_anonymous boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index if not exists users_email_partial_key on auth.users (email) where email is not null;
revoke all on auth.users from public, anon, authenticated;

create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
