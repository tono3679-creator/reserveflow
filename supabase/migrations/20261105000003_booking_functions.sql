-- ReserveFlow：予約の作成・変更・ステータス変更（DB 関数）
--
-- 予約の書き込みはこの関数だけが行う。1回の呼び出しが1トランザクションの中で
--   権限の確認 → テナント・店舗の整合 → サービスとスタッフ・設備の対応 → 設備の割り当て → 書き込み
--   → ステータス履歴 → 通知の出来事 → 操作履歴
-- をまとめて行い、どこかで失敗すれば何も残らない。
-- 時間の重なりは最後に排他制約が判定するので、同時に同じ枠を取ろうとしても片方は失敗する。
--
-- 呼び出し元
--   * ログイン利用者（role = authenticated）：権限を確かめる
--   * アプリのサーバー（DB 所有者の接続）：公開予約ページから。権限の代わりに、サーバーが受付ルールを確かめてから呼ぶ
-- 利用者に見せる失敗は errcode P0001 と日本語の文で返す（アプリはその文をそのまま表示する）。

-- 呼び出し元がログイン利用者（authenticated / anon）か
create or replace function app_private.called_by_user() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('role', true), 'none') in ('authenticated', 'anon')
$$;

-- 予約の内容（店舗・サービス・スタッフ）が正しい組み合わせか確かめ、サービスの前後バッファを返す
create or replace function app_private.validate_booking_target(
  p_org uuid, p_location uuid, p_service uuid, p_staff uuid,
  out buffer_before integer, out buffer_after integer
) language plpgsql stable set search_path = '' as $$
declare
  v_selection public.staff_selection;
begin
  select s.buffer_before_minutes, s.buffer_after_minutes into buffer_before, buffer_after
    from public.services s
   where s.id = p_service and s.location_id = p_location and s.organization_id = p_org and s.is_active;
  if not found then
    raise exception 'このサービスは選べません（店舗が違うか、利用停止中です）';
  end if;
  select t.staff_selection into v_selection from public.tenant_settings t where t.location_id = p_location;
  if p_staff is null then
    if v_selection = 'required' then
      raise exception 'この店舗では担当スタッフの指定が必要です';
    end if;
    return;
  end if;
  if v_selection = 'none' then
    raise exception 'この店舗では担当スタッフを割り当てません';
  end if;
  if not exists (select 1 from public.staff st where st.id = p_staff and st.location_id = p_location and st.is_active) then
    raise exception 'このスタッフは選べません（店舗が違うか、利用停止中です）';
  end if;
  if not exists (select 1 from public.service_staff ss where ss.service_id = p_service and ss.staff_id = p_staff) then
    raise exception 'このスタッフはこのサービスを担当していません';
  end if;
end $$;

-- 必要な設備を割り当てる（サービスに登録した設備のうち、空いているものを並び順に試す）
create or replace function app_private.assign_booking_resource(p_booking uuid, p_preferred uuid) returns uuid
language plpgsql set search_path = '' as $$
declare
  b record;
  r record;
begin
  select id, organization_id, service_id, occupied, status into b from public.bookings where id = p_booking;
  delete from public.booking_resources where booking_id = p_booking;
  if not exists (select 1 from public.service_resources where service_id = b.service_id) then
    return null;
  end if;
  if p_preferred is not null and not exists (
    select 1 from public.service_resources where service_id = b.service_id and resource_id = p_preferred) then
    raise exception 'この設備はこのサービスでは使えません';
  end if;
  for r in
    select res.id from public.service_resources sr join public.resources res on res.id = sr.resource_id
     where sr.service_id = b.service_id and res.is_active and (p_preferred is null or res.id = p_preferred)
     order by res.sort_order, res.name
  loop
    begin
      insert into public.booking_resources (organization_id, booking_id, resource_id, occupied, is_active)
      values (b.organization_id, b.id, r.id, b.occupied, public.booking_blocks_slot(b.status));
      return r.id;
    exception when exclusion_violation then
      -- この設備は埋まっている。次を試す
    end;
  end loop;
  raise exception '同じ時間に使える設備が空いていません。別の時間を選んでください' using constraint = 'booking_resources_no_overlap';
end $$;

-- 通知の出来事を作る（dedupe_key が同じものは作らない＝同じ出来事を二重に通知しない）
create or replace function app_private.enqueue_notification(p_booking uuid, p_type public.notification_type, p_dedupe text)
returns void language plpgsql set search_path = '' as $$
begin
  insert into public.notification_events (organization_id, location_id, booking_id, type, dedupe_key, payload)
  select b.organization_id, b.location_id, b.id, p_type, p_dedupe,
         jsonb_build_object(
           'customer_name', c.name, 'customer_email', c.email, 'service_name', s.name, 'staff_name', st.name,
           'starts_at', b.starts_at, 'ends_at', b.ends_at, 'price', b.price, 'status', b.status,
           'location_name', l.name, 'timezone', l.timezone, 'cancel_reason', b.cancel_reason)
    from public.bookings b
    join public.customers c on c.id = b.customer_id
    join public.services s on s.id = b.service_id
    join public.locations l on l.id = b.location_id
    left join public.staff st on st.id = b.staff_id
   where b.id = p_booking
  on conflict (dedupe_key) do nothing;
end $$;

-- ---------------------------------------------------------------
-- 予約の作成
-- ---------------------------------------------------------------
create or replace function public.create_booking(
  p_location uuid, p_customer uuid, p_service uuid, p_staff uuid,
  p_starts_at timestamptz, p_ends_at timestamptz, p_price integer,
  p_notes text default null, p_status public.booking_status default 'confirmed',
  p_source public.booking_source default 'admin', p_resource uuid default null,
  p_customer_message text default null, p_manage_token_hash text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_buf record;
  v_id uuid;
begin
  select organization_id into v_org from public.locations where id = p_location and is_active;
  if v_org is null then
    raise exception '店舗が見つかりません';
  end if;
  if app_private.called_by_user() then
    if not app_private.is_manager(v_org) then
      raise exception '予約を登録する権限がありません' using errcode = '42501';
    end if;
    if p_source = 'public' then
      raise exception '公開予約はサーバーからのみ登録できます' using errcode = '42501';
    end if;
  end if;
  if p_status not in ('confirmed', 'checked_in', 'completed') then
    raise exception '新しい予約のステータスは「予約確定」「来店済み」「サービス完了」から選んでください';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception '終了時刻は開始時刻より後にしてください';
  end if;
  if not exists (select 1 from public.customers where id = p_customer and organization_id = v_org) then
    raise exception '顧客が見つかりません';
  end if;
  select * into v_buf from app_private.validate_booking_target(v_org, p_location, p_service, p_staff);

  insert into public.bookings (organization_id, location_id, customer_id, service_id, staff_id, starts_at, ends_at,
    buffer_before_minutes, buffer_after_minutes, occupied, price, status, notes, customer_message, source,
    manage_token_hash, created_by)
  values (v_org, p_location, p_customer, p_service, p_staff, p_starts_at, p_ends_at,
    v_buf.buffer_before, v_buf.buffer_after, tstzrange(p_starts_at, p_ends_at), p_price, p_status,
    nullif(btrim(p_notes), ''), nullif(btrim(p_customer_message), ''), p_source, p_manage_token_hash, auth.uid())
  returning id into v_id;

  perform app_private.assign_booking_resource(v_id, p_resource);
  insert into public.booking_status_history (organization_id, booking_id, from_status, to_status, changed_by, source)
  values (v_org, v_id, null, p_status, auth.uid(), p_source);
  perform app_private.enqueue_notification(v_id, 'booking_confirmed', 'booking_confirmed:' || v_id);
  insert into public.audit_logs (organization_id, actor_user_id, action, target_type, target_id, details)
  values (v_org, auth.uid(), 'booking.create', 'booking', v_id, jsonb_build_object('source', p_source));
  return v_id;
end $$;

-- ---------------------------------------------------------------
-- 予約の変更（日時・担当・サービス・料金・備考・顧客）
--   p_version：画面を開いたときの版。ほかの人が先に変更していれば失敗する（楽観ロック）
-- ---------------------------------------------------------------
create or replace function public.update_booking(
  p_booking uuid, p_version integer, p_customer uuid, p_service uuid, p_staff uuid,
  p_starts_at timestamptz, p_ends_at timestamptz, p_price integer, p_notes text,
  p_resource uuid default null, p_source public.booking_source default 'admin'
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_buf record;
  v_moved boolean;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or (app_private.called_by_user() and not app_private.is_member(b.organization_id)) then
    raise exception '予約が見つかりません';
  end if;
  if app_private.called_by_user() and not app_private.is_manager(b.organization_id) then
    raise exception '予約を変更する権限がありません' using errcode = '42501';
  end if;
  if b.version <> p_version then
    raise exception 'この予約はほかの操作で更新されています。画面を読み込み直してから、もう一度お試しください';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception '終了時刻は開始時刻より後にしてください';
  end if;
  v_moved := b.starts_at <> p_starts_at or b.ends_at <> p_ends_at or b.staff_id is distinct from p_staff or b.service_id <> p_service;
  if v_moved and not public.booking_blocks_slot(b.status) then
    raise exception 'キャンセル・無断キャンセルの予約は日時や担当を変更できません。予約確定に戻してから変更してください';
  end if;
  if not exists (select 1 from public.customers where id = p_customer and organization_id = b.organization_id) then
    raise exception '顧客が見つかりません';
  end if;
  select * into v_buf from app_private.validate_booking_target(b.organization_id, b.location_id, p_service, p_staff);

  update public.bookings set
    customer_id = p_customer, service_id = p_service, staff_id = p_staff, starts_at = p_starts_at, ends_at = p_ends_at,
    buffer_before_minutes = case when service_id = p_service then buffer_before_minutes else v_buf.buffer_before end,
    buffer_after_minutes = case when service_id = p_service then buffer_after_minutes else v_buf.buffer_after end,
    price = p_price, notes = nullif(btrim(p_notes), ''), version = version + 1
  where id = p_booking;

  if v_moved or p_resource is not null then
    perform app_private.assign_booking_resource(p_booking, p_resource);
  end if;
  if v_moved then
    perform app_private.enqueue_notification(p_booking, 'booking_changed', 'booking_changed:' || p_booking || ':' || (b.version + 1));
  end if;
  insert into public.audit_logs (organization_id, actor_user_id, action, target_type, target_id, details)
  values (b.organization_id, auth.uid(), 'booking.update', 'booking', p_booking,
          jsonb_build_object('moved', v_moved, 'source', p_source));
  return b.version + 1;
end $$;

-- ---------------------------------------------------------------
-- ステータスの変更
--   staff は自分の担当予約の「来店済み・サービス完了・無断キャンセル」と、その取り消しだけ
-- ---------------------------------------------------------------
create or replace function public.set_booking_status(
  p_booking uuid, p_version integer, p_status public.booking_status, p_reason text default null,
  p_source public.booking_source default 'admin'
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_allowed public.booking_status[];
  v_staff_ok boolean;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then
    raise exception '予約が見つかりません';
  end if;
  if app_private.called_by_user() then
    v_staff_ok := app_private.is_member(b.organization_id) and b.staff_id = any (app_private.my_staff_ids());
    if not app_private.is_manager(b.organization_id) and not v_staff_ok then
      raise exception '予約が見つかりません';
    end if;
    if not app_private.is_manager(b.organization_id)
       and (p_status in ('cancelled_customer', 'cancelled_store') or b.status in ('cancelled_customer', 'cancelled_store')) then
      raise exception 'キャンセルの操作はマネージャー以上が行います' using errcode = '42501';
    end if;
  end if;
  if b.version <> p_version then
    raise exception 'この予約はほかの操作で更新されています。画面を読み込み直してから、もう一度お試しください';
  end if;
  if b.status = p_status then
    return b.version;
  end if;
  -- 変更できる組み合わせ
  v_allowed := case b.status
    when 'confirmed' then array['checked_in', 'completed', 'cancelled_customer', 'cancelled_store', 'no_show']
    when 'checked_in' then array['confirmed', 'completed', 'no_show']
    when 'completed' then array['checked_in', 'confirmed']
    when 'no_show' then array['confirmed', 'checked_in', 'completed']
    else array['confirmed'] -- キャンセルからは予約確定に戻すだけ（枠が空いていなければ排他制約で失敗する）
  end::public.booking_status[];
  if not (p_status = any (v_allowed)) then
    raise exception 'このステータスには変更できません';
  end if;
  if p_status in ('checked_in', 'completed', 'no_show') and b.starts_at > now() + interval '1 hour' then
    raise exception '開始前の予約は「来店済み」「サービス完了」「無断キャンセル」にできません';
  end if;

  update public.bookings set
    status = p_status,
    cancelled_at = case when p_status in ('cancelled_customer', 'cancelled_store') then now() else null end,
    cancel_reason = case when p_status in ('cancelled_customer', 'cancelled_store') then nullif(btrim(p_reason), '') else null end,
    version = version + 1
  where id = p_booking;
  insert into public.booking_status_history (organization_id, booking_id, from_status, to_status, changed_by, source, reason)
  values (b.organization_id, p_booking, b.status, p_status, auth.uid(), p_source, nullif(btrim(p_reason), ''));
  if p_status in ('cancelled_customer', 'cancelled_store') then
    perform app_private.enqueue_notification(p_booking, 'booking_cancelled', 'booking_cancelled:' || p_booking || ':' || (b.version + 1));
  elsif b.status in ('cancelled_customer', 'cancelled_store') then
    perform app_private.enqueue_notification(p_booking, 'booking_confirmed', 'booking_confirmed:' || p_booking || ':' || (b.version + 1));
  end if;
  insert into public.audit_logs (organization_id, actor_user_id, action, target_type, target_id, details)
  values (b.organization_id, auth.uid(), 'booking.status', 'booking', p_booking,
          jsonb_build_object('from', b.status, 'to', p_status, 'source', p_source));
  return b.version + 1;
end $$;

revoke all on function app_private.called_by_user(), app_private.validate_booking_target(uuid, uuid, uuid, uuid),
  app_private.assign_booking_resource(uuid, uuid), app_private.enqueue_notification(uuid, public.notification_type, text)
  from public, anon, authenticated;
revoke all on function
  public.create_booking(uuid, uuid, uuid, uuid, timestamptz, timestamptz, integer, text, public.booking_status, public.booking_source, uuid, text, text),
  public.update_booking(uuid, integer, uuid, uuid, uuid, timestamptz, timestamptz, integer, text, uuid, public.booking_source),
  public.set_booking_status(uuid, integer, public.booking_status, text, public.booking_source)
  from public, anon;
grant execute on function
  public.create_booking(uuid, uuid, uuid, uuid, timestamptz, timestamptz, integer, text, public.booking_status, public.booking_source, uuid, text, text),
  public.update_booking(uuid, integer, uuid, uuid, uuid, timestamptz, timestamptz, integer, text, uuid, public.booking_source),
  public.set_booking_status(uuid, integer, public.booking_status, text, public.booking_source)
  to authenticated;
