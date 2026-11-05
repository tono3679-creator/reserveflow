-- ReserveFlow：権限（RLS）
--
-- * ログイン中の利用者は authenticated ロールで、auth.uid() が利用者 ID を返す
-- * 所属する企業（organization_members）のデータだけが見える。別の企業の行は1行も返らない
-- * 役割ごとの操作
--     owner   … すべて（店舗設定・サービス・スタッフ・メンバー・売上）
--     manager … 予約・顧客・スタッフの勤務・分析の閲覧
--     staff   … 自分が担当する予約と、その顧客だけ
-- * 予約の作成・変更・ステータス変更は DB 関数だけが行う（authenticated は bookings を直接書き換えられない）
-- * 未ログイン（anon）はテーブルを一切読めない。公開予約ページはサーバーが必要な項目だけを返す

-- ---------------------------------------------------------------
-- 権限の判定（security definer：organization_members の RLS を経由せずに判定する）
-- ---------------------------------------------------------------
create or replace function app_private.member_role(p_org uuid) returns public.member_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.organization_members m
   where m.organization_id = p_org and m.user_id = auth.uid() and m.is_active
$$;

create or replace function app_private.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.member_role(p_org) is not null
$$;

create or replace function app_private.is_manager(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app_private.member_role(p_org) in ('owner', 'manager'), false)
$$;

create or replace function app_private.is_owner(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app_private.member_role(p_org) = 'owner', false)
$$;

-- ログイン中の利用者に結び付いたスタッフ（担当者）
create or replace function app_private.my_staff_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(s.id), '{}')
    from public.staff s join public.organization_members m on m.id = s.member_id
   where m.user_id = auth.uid() and m.is_active
$$;

-- 顧客を見てよいか：owner / manager はすべて、staff は自分が担当した（する）予約の顧客と、担当スタッフに指定された顧客
create or replace function app_private.can_view_customer(p_org uuid, p_customer uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.is_manager(p_org)
      or (app_private.is_member(p_org) and (
            exists (select 1 from public.bookings b
                     where b.customer_id = p_customer and b.staff_id = any (app_private.my_staff_ids()))
         or exists (select 1 from public.customers c
                     where c.id = p_customer and c.preferred_staff_id = any (app_private.my_staff_ids()))))
$$;

grant usage on schema app_private to authenticated;
revoke all on all functions in schema app_private from public, anon, authenticated;
grant execute on function app_private.member_role(uuid), app_private.is_member(uuid), app_private.is_manager(uuid),
  app_private.is_owner(uuid), app_private.my_staff_ids(), app_private.can_view_customer(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------
-- テーブルの権限：Supabase の既定（全権限）を外し、必要な分だけ付け直す
-- ---------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.booking_blocks_slot(public.booking_status) to authenticated;

grant select on all tables in schema public to authenticated;
grant update (name) on public.organizations to authenticated;
grant update (name, logo_url, phone, email, address, timezone) on public.locations to authenticated;
grant update (public_booking_enabled, staff_selection, slot_interval_minutes, min_lead_minutes, max_advance_days,
  cancel_deadline_hours, cancellation_policy, segment_repeat_min_visits, segment_vip_min_visits, segment_vip_min_spend,
  segment_dormant_days, weight_preferred_time, weight_gap, weight_balance, weight_idle, remind_day_before, remind_same_day)
  on public.tenant_settings to authenticated;
grant insert, update, delete on public.business_hours, public.business_hour_exceptions, public.staff, public.staff_schedules,
  public.staff_time_off, public.services, public.service_staff, public.resources, public.service_resources,
  public.customers, public.customer_notes to authenticated;
-- bookings / booking_resources / booking_status_history / notification_* / audit_logs / organization_members は
-- 読み取りのみ（書き込みは DB 関数）

-- 以後このマイグレーションの利用者が作る表・関数に、自動で権限が付かないようにする
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- ---------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['organizations', 'locations', 'tenant_settings', 'business_hours', 'business_hour_exceptions',
    'organization_members', 'staff', 'staff_schedules', 'staff_time_off', 'services', 'service_staff', 'resources',
    'service_resources', 'customers', 'customer_notes', 'bookings', 'booking_resources', 'booking_status_history',
    'notification_events', 'notification_deliveries', 'audit_logs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- 企業・店舗・店舗設定：メンバーは読める、オーナーだけ変更できる
create policy organizations_select on public.organizations for select to authenticated
  using (app_private.is_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (app_private.is_owner(id)) with check (app_private.is_owner(id));

create policy locations_select on public.locations for select to authenticated
  using (app_private.is_member(organization_id));
create policy locations_update on public.locations for update to authenticated
  using (app_private.is_owner(organization_id)) with check (app_private.is_owner(organization_id));

create policy tenant_settings_select on public.tenant_settings for select to authenticated
  using (app_private.is_member(organization_id));
create policy tenant_settings_update on public.tenant_settings for update to authenticated
  using (app_private.is_owner(organization_id)) with check (app_private.is_owner(organization_id));

-- オーナーだけが書き換えられる店舗のマスタ（営業時間・サービス・設備・スタッフ）
do $$
declare t text;
begin
  foreach t in array array['business_hours', 'business_hour_exceptions', 'staff', 'services', 'service_staff',
    'resources', 'service_resources']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (app_private.is_member(organization_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app_private.is_owner(organization_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (app_private.is_owner(organization_id)) with check (app_private.is_owner(organization_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (app_private.is_owner(organization_id))', t || '_delete', t);
  end loop;
end $$;

-- スタッフの勤務・休暇：オーナーとマネージャーが管理する
do $$
declare t text;
begin
  foreach t in array array['staff_schedules', 'staff_time_off']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (app_private.is_member(organization_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app_private.is_manager(organization_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (app_private.is_manager(organization_id)) with check (app_private.is_manager(organization_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (app_private.is_manager(organization_id))', t || '_delete', t);
  end loop;
end $$;

-- メンバー：同じ企業のメンバー一覧は見える（変更は DB 関数）
create policy organization_members_select on public.organization_members for select to authenticated
  using (app_private.is_member(organization_id));

-- 顧客（個人情報）：staff は担当する予約の顧客だけ
create policy customers_select on public.customers for select to authenticated
  using (app_private.can_view_customer(organization_id, id));
create policy customers_insert on public.customers for insert to authenticated
  with check (app_private.is_manager(organization_id));
create policy customers_update on public.customers for update to authenticated
  using (app_private.is_manager(organization_id)) with check (app_private.is_manager(organization_id));
create policy customers_delete on public.customers for delete to authenticated
  using (app_private.is_manager(organization_id));

-- 顧客メモ：顧客を見られる人は読める・書ける（自分の名前で）。消せるのは書いた本人と owner / manager
create policy customer_notes_select on public.customer_notes for select to authenticated
  using (app_private.can_view_customer(organization_id, customer_id));
create policy customer_notes_insert on public.customer_notes for insert to authenticated
  with check (
    app_private.can_view_customer(organization_id, customer_id)
    and author_member_id in (select m.id from public.organization_members m where m.user_id = auth.uid() and m.organization_id = customer_notes.organization_id)
  );
create policy customer_notes_update on public.customer_notes for update to authenticated
  using (author_member_id in (select m.id from public.organization_members m where m.user_id = auth.uid()))
  with check (author_member_id in (select m.id from public.organization_members m where m.user_id = auth.uid()));
create policy customer_notes_delete on public.customer_notes for delete to authenticated
  using (app_private.is_manager(organization_id)
      or author_member_id in (select m.id from public.organization_members m where m.user_id = auth.uid()));

-- 予約：owner / manager はすべて、staff は自分が担当する予約だけ
create policy bookings_select on public.bookings for select to authenticated
  using (app_private.is_manager(organization_id)
      or (app_private.is_member(organization_id) and staff_id = any (app_private.my_staff_ids())));

-- 予約に付随する行は、予約が見える場合だけ（bookings の RLS がそのまま効く）
create policy booking_resources_select on public.booking_resources for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id));
create policy booking_status_history_select on public.booking_status_history for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id));

-- 通知・操作履歴
create policy notification_events_select on public.notification_events for select to authenticated
  using (app_private.is_manager(organization_id));
create policy notification_deliveries_select on public.notification_deliveries for select to authenticated
  using (app_private.is_manager(organization_id));
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (app_private.is_owner(organization_id));

-- ---------------------------------------------------------------
-- 操作履歴の記録（メンバーが、自分の所属する企業に対してだけ書ける。行為者は必ずログイン中の利用者）
-- ---------------------------------------------------------------
create or replace function public.write_audit_log(p_org uuid, p_action text, p_target_type text, p_target_id uuid, p_details jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_member(p_org) then
    raise exception '操作履歴を記録する権限がありません' using errcode = '42501';
  end if;
  insert into public.audit_logs (organization_id, actor_user_id, action, target_type, target_id, details)
  values (p_org, auth.uid(), left(p_action, 80), left(p_target_type, 40), p_target_id, coalesce(p_details, '{}'::jsonb));
end $$;
revoke all on function public.write_audit_log(uuid, text, text, uuid, jsonb) from public, anon;
grant execute on function public.write_audit_log(uuid, text, text, uuid, jsonb) to authenticated;
