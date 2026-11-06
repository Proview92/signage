-- PROVIEW SIGNAGE: bring the live database back to the latest version.
-- Re-applies migrations 002-022 in order. Safe to run more than once.
-- (Two one-off data tidy-ups from 002 and 006 are left out on purpose.)


-- ===== 002_licenses.sql =====
-- =====================================================================
--  PROVIEW SIGNAGE — per-TV licences
--  Run in Supabase SQL Editor after schema.sql. Safe to re-run.
--
--  Each screen (TV) has a licence: trial7, m1, m3, m6, m12, m24, m36,
--  lifetime or custom. Only admins can change it. After expiry the TV
--  keeps playing for a 7-day grace period, then shows "Licence expired".
-- =====================================================================

alter table public.screens add column if not exists license_type       text;
alter table public.screens add column if not exists license_starts_at  timestamptz;
alter table public.screens add column if not exists license_expires_at timestamptz;   -- null = lifetime
alter table public.screens add column if not exists license_notes      text;
alter table public.screens add column if not exists license_updated_at timestamptz;

do $$ begin
  alter table public.screens add constraint screens_license_type_chk
    check (license_type is null or license_type in ('trial7','m1','m3','m6','m12','m24','m36','lifetime','custom'));
exception when duplicate_object then null; end $$;

create index if not exists screens_license_exp_idx on public.screens(license_expires_at);

-- Grace period length (keep in sync with web/js/license.js)
create or replace function public.license_grace() returns interval
language sql immutable as $$ select interval '7 days' $$;

-- True while the TV may play: licensed and not past expiry + grace.
create or replace function public.license_ok(p_type text, p_expires timestamptz)
returns boolean language sql stable as $$
  select p_type is not null
     and (p_type = 'lifetime' or p_expires is null or p_expires + public.license_grace() > now());
$$;

create or replace function public.license_interval(p_type text)
returns interval language sql immutable as $$
  select case p_type
    when 'trial7' then interval '7 days'
    when 'm1'  then interval '1 month'
    when 'm3'  then interval '3 months'
    when 'm6'  then interval '6 months'
    when 'm12' then interval '12 months'
    when 'm24' then interval '24 months'
    when 'm36' then interval '36 months'
  end;
$$;

-- Give any already-paired TV without a licence a 7-day trial.
-- (one-off trial grant skipped)

-- ---------------------------------------------------------------------
--  Admin: set / extend a licence
--    p_extend = true  → add the period on top of the current expiry
--                       (if it hasn't expired yet), otherwise from now
--    p_type = 'custom' → use p_expires
-- ---------------------------------------------------------------------
create or replace function public.set_screen_license(
  p_screen uuid, p_type text, p_extend boolean default false,
  p_expires timestamptz default null, p_notes text default null)
returns public.screens language plpgsql security definer set search_path = public as $$
declare
  s public.screens;
  base timestamptz;
  new_exp timestamptz;
begin
  if not public.is_admin() then raise exception 'Only the administrator can change licences.'; end if;
  select * into s from public.screens where id = p_screen for update;
  if not found then raise exception 'screen not found'; end if;

  if p_type = 'lifetime' then
    new_exp := null;
  elsif p_type = 'custom' then
    if p_expires is null then raise exception 'Choose an expiry date.'; end if;
    new_exp := p_expires;
  elsif public.license_interval(p_type) is not null then
    base := case when p_extend and s.license_type <> 'lifetime'
                      and s.license_expires_at is not null and s.license_expires_at > now()
                 then s.license_expires_at else now() end;
    new_exp := base + public.license_interval(p_type);
  else
    raise exception 'Unknown licence type %', p_type;
  end if;

  update public.screens
     set license_type = p_type,
         license_starts_at = case when p_extend and s.license_starts_at is not null then s.license_starts_at else now() end,
         license_expires_at = new_exp,
         license_notes = coalesce(nullif(trim(p_notes), ''), license_notes),
         license_updated_at = now()
   where id = p_screen
  returning * into s;
  return s;
end;
$$;

-- ---------------------------------------------------------------------
--  Pairing: new TVs start on a 7-day trial (once per device)
-- ---------------------------------------------------------------------
create or replace function public.claim_screen(p_code text, p_name text default null, p_client uuid default null)
returns public.screens language plpgsql security definer set search_path = public as $$
declare
  s public.screens;
begin
  if not public.is_real_user() then raise exception 'sign in to pair a screen'; end if;
  if p_client is null and not public.is_admin() then raise exception 'choose a client'; end if;
  if p_client is not null and not public.is_member(p_client, array['manager']) then
    raise exception 'only managers can add screens';
  end if;
  update public.screens
     set claimed = true, client_id = p_client, pairing_code = null,
         name = coalesce(nullif(trim(p_name), ''), name),
         license_type       = coalesce(license_type, 'trial7'),
         license_starts_at  = case when license_type is null then now() else license_starts_at end,
         license_expires_at = case when license_type is null then now() + interval '7 days' else license_expires_at end,
         license_updated_at = case when license_type is null then now() else license_updated_at end
   where pairing_code = upper(replace(trim(p_code), ' ', '')) and not claimed
  returning * into s;
  if not found then
    raise exception 'No screen is showing that code. Check the code on the TV and try again.';
  end if;
  return s;
end;
$$;

-- ---------------------------------------------------------------------
--  Enforcement
-- ---------------------------------------------------------------------

-- Clients can't edit licence fields (only via set_screen_license as admin).
-- NOT security definer on purpose: current_user must be the caller's role
-- ('authenticated' for direct API edits; the owner inside our RPCs).
create or replace function public.screens_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    null;
  elsif not public.is_admin() then
    if new.client_id is distinct from old.client_id
       or new.device_user_id is distinct from old.device_user_id
       or new.claimed is distinct from old.claimed
       or new.content is distinct from old.content
       or new.pairing_code is distinct from old.pairing_code
       or new.license_type is distinct from old.license_type
       or new.license_starts_at is distinct from old.license_starts_at
       or new.license_expires_at is distinct from old.license_expires_at
       or new.license_notes is distinct from old.license_notes
       or new.license_updated_at is distinct from old.license_updated_at then
      raise exception 'not allowed to change those screen fields';
    end if;
  end if;
  if new.default_playlist_id is distinct from old.default_playlist_id then
    if new.default_playlist_id is not null and not exists (
      select 1 from public.playlists p where p.id = new.default_playlist_id and p.client_id = new.client_id) then
      raise exception 'playlist belongs to a different client';
    end if;
    new.schedule_updated_at := now();
  end if;
  return new;
end;
$$;

-- Can't publish to an expired TV.
create or replace function public.publish_screen(p_screen uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s public.screens;
begin
  select * into s from public.screens where id = p_screen;
  if s.client_id is null or not public.is_member(s.client_id) then raise exception 'screen not found'; end if;
  if not public.license_ok(s.license_type, s.license_expires_at) then
    raise exception 'The licence for "%" has expired. Contact Proview to renew it.', s.name;
  end if;
  update public.screens
     set content = public._build_screen_content(p_screen), published_at = now()
   where id = p_screen;
end;
$$;

-- Publishing a playlist skips expired TVs.
create or replace function public.publish_playlist(p_playlist uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  c uuid; n int := 0; sid uuid;
begin
  select client_id into c from public.playlists where id = p_playlist;
  if c is null or not public.is_member(c) then raise exception 'playlist not found'; end if;
  for sid in
    select id from public.screens
     where client_id = c
       and public.license_ok(license_type, license_expires_at)
       and (default_playlist_id = p_playlist
            or id in (select screen_id from public.schedule_items where playlist_id = p_playlist))
  loop
    update public.screens set content = public._build_screen_content(sid), published_at = now() where id = sid;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Expired TVs (past grace) can no longer download media.
drop policy if exists media_device_read on storage.objects;
create policy media_device_read on storage.objects for select to authenticated
  using (
    bucket_id = 'media'
    and exists (
      select 1 from public.screens s
       where s.device_user_id = auth.uid()
         and public.license_ok(s.license_type, s.license_expires_at)
         and s.client_id::text = (storage.foldername(storage.objects.name))[1]));

-- Permissions
revoke all on function public.set_screen_license(uuid, text, boolean, timestamptz, text) from public, anon;
grant execute on function public.set_screen_license(uuid, text, boolean, timestamptz, text) to authenticated;
revoke all on function public.claim_screen(text, text, uuid) from public, anon;
grant execute on function public.claim_screen(text, text, uuid) to authenticated;
revoke all on function public.publish_screen(uuid) from public, anon;
grant execute on function public.publish_screen(uuid) to authenticated;
revoke all on function public.publish_playlist(uuid) from public, anon;
grant execute on function public.publish_playlist(uuid) to authenticated;


-- ===== 003_trial_devices.sql =====
-- =====================================================================
--  PROVIEW SIGNAGE — one free trial per physical device
--  Run after 002_licenses.sql. Safe to re-run.
--
--  The TV app sends a hashed Android device ID ("hw") that survives app
--  reinstalls. A device gets the automatic 7-day trial only once. Devices
--  that send no ID (e.g. a browser player) get no automatic trial — the
--  admin licenses them manually.
-- =====================================================================

alter table public.screens add column if not exists hardware_id          text;
alter table public.screens add column if not exists trial_blocked_reason text;
create index if not exists screens_hardware_idx on public.screens(hardware_id);

create table if not exists public.trial_devices (
  hardware_id  text primary key,
  screen_id    uuid references public.screens(id) on delete set null,
  used_at      timestamptz not null default now()
);
alter table public.trial_devices enable row level security;
drop policy if exists trial_devices_admin on public.trial_devices;
create policy trial_devices_admin on public.trial_devices for select to authenticated
  using (public.is_admin());

-- Screens that already started a trial on a known device count as used.
insert into public.trial_devices (hardware_id, screen_id, used_at)
select hardware_id, id, coalesce(license_starts_at, now())
  from public.screens
 where hardware_id is not null and license_type is not null
on conflict (hardware_id) do nothing;

-- TV registration: also records the device ID (64 hex chars only).
create or replace function public.register_device(p_info jsonb default '{}'::jsonb)
returns public.screens language plpgsql security definer set search_path = public as $$
declare
  s public.screens;
  hw text := lower(coalesce(p_info ->> 'hw', ''));
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if hw !~ '^[0-9a-f]{64}$' then hw := null; end if;
  select * into s from public.screens where device_user_id = auth.uid();
  if not found then
    insert into public.screens (device_user_id, pairing_code, device_info, last_seen, hardware_id)
    values (auth.uid(), public.gen_pairing_code(), coalesce(p_info, '{}'), now(), hw)
    returning * into s;
  else
    update public.screens
       set last_seen = now(),
           device_info = device_info || coalesce(p_info, '{}'),
           hardware_id = coalesce(hardware_id, hw),
           pairing_code = case
             when not claimed and (pairing_code is null or created_at < now() - interval '1 hour')
               then public.gen_pairing_code() else pairing_code end,
           created_at = case
             when not claimed and created_at < now() - interval '1 hour' then now() else created_at end
     where id = s.id
     returning * into s;
  end if;
  return s;
end;
$$;

-- Pairing: trial only for a known device that hasn't had one.
create or replace function public.claim_screen(p_code text, p_name text default null, p_client uuid default null)
returns public.screens language plpgsql security definer set search_path = public as $$
declare
  s public.screens;
  give_trial boolean := false;
  reason text := null;
begin
  if not public.is_real_user() then raise exception 'sign in to pair a screen'; end if;
  if p_client is null and not public.is_admin() then raise exception 'choose a client'; end if;
  if p_client is not null and not public.is_member(p_client, array['manager']) then
    raise exception 'only managers can add screens';
  end if;

  select * into s from public.screens
   where pairing_code = upper(replace(trim(p_code), ' ', '')) and not claimed
   for update;
  if not found then
    raise exception 'No screen is showing that code. Check the code on the TV and try again.';
  end if;

  if s.license_type is null then
    if s.hardware_id is null then
      reason := 'no device ID: use the PROVIEW SIGNAGE TV app, or ask Proview for a licence';
    elsif exists (select 1 from public.trial_devices where hardware_id = s.hardware_id) then
      reason := 'this device has already used its free trial';
    else
      give_trial := true;
      insert into public.trial_devices (hardware_id, screen_id) values (s.hardware_id, s.id)
      on conflict (hardware_id) do nothing;
    end if;
  end if;

  update public.screens
     set claimed = true, client_id = p_client, pairing_code = null,
         name = coalesce(nullif(trim(p_name), ''), name),
         license_type       = case when give_trial then 'trial7' else license_type end,
         license_starts_at  = case when give_trial then now() else license_starts_at end,
         license_expires_at = case when give_trial then now() + interval '7 days' else license_expires_at end,
         license_updated_at = case when give_trial then now() else license_updated_at end,
         trial_blocked_reason = case when license_type is null and not give_trial then reason else trial_blocked_reason end
   where id = s.id
  returning * into s;
  return s;
end;
$$;

-- Licensing a screen clears the "no trial" reason.
create or replace function public.clear_trial_reason()
returns trigger language plpgsql as $$
begin
  if new.license_type is not null then new.trial_blocked_reason := null; end if;
  return new;
end;
$$;
drop trigger if exists screens_clear_trial_reason on public.screens;
create trigger screens_clear_trial_reason before update on public.screens
  for each row execute function public.clear_trial_reason();

-- Clients can't set these themselves.
create or replace function public.screens_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    null;
  elsif not public.is_admin() then
    if new.client_id is distinct from old.client_id
       or new.device_user_id is distinct from old.device_user_id
       or new.claimed is distinct from old.claimed
       or new.content is distinct from old.content
       or new.pairing_code is distinct from old.pairing_code
       or new.hardware_id is distinct from old.hardware_id
       or new.trial_blocked_reason is distinct from old.trial_blocked_reason
       or new.license_type is distinct from old.license_type
       or new.license_starts_at is distinct from old.license_starts_at
       or new.license_expires_at is distinct from old.license_expires_at
       or new.license_notes is distinct from old.license_notes
       or new.license_updated_at is distinct from old.license_updated_at then
      raise exception 'not allowed to change those screen fields';
    end if;
  end if;
  if new.default_playlist_id is distinct from old.default_playlist_id then
    if new.default_playlist_id is not null and not exists (
      select 1 from public.playlists p where p.id = new.default_playlist_id and p.client_id = new.client_id) then
      raise exception 'playlist belongs to a different client';
    end if;
    new.schedule_updated_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.register_device(jsonb) from public, anon;
grant execute on function public.register_device(jsonb) to authenticated;
revoke all on function public.claim_screen(text, text, uuid) from public, anon;
grant execute on function public.claim_screen(text, text, uuid) to authenticated;


-- ===== 004_tv_remote.sql =====
-- =====================================================================
--  PROVIEW SIGNAGE — TV remote menu settings (PIN + auto-return)
--  Run after 003_trial_devices.sql. Safe to re-run.
--
--  One set of settings for all TVs, managed by the admin:
--    remote_pin_hash  sha256('proview-pin:' || pin), hex. Default PIN 1234.
--    return_minutes   reopen the player this many minutes after someone
--                     leaves it (Home button / Exit). 0 = never.
--  Only TVs (anonymous sessions) and admins can read the PIN hash.
-- =====================================================================

create table if not exists public.app_settings (
  id               int primary key default 1 check (id = 1),
  remote_pin_hash  text,
  pin_is_default   boolean not null default true,
  return_minutes   int not null default 5 check (return_minutes between 0 and 240),
  updated_at       timestamptz not null default now()
);
insert into public.app_settings (id, remote_pin_hash, pin_is_default)
values (1, encode(sha256(convert_to('proview-pin:1234', 'UTF8')), 'hex'), true)
on conflict (id) do nothing;

alter table public.app_settings enable row level security;
drop policy if exists app_settings_admin on public.app_settings;
create policy app_settings_admin on public.app_settings for select to authenticated
  using (public.is_admin());

-- TV: fetch remote settings (anonymous TV sessions only).
create or replace function public.get_tv_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is not null and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    then (select jsonb_build_object('pin_hash', remote_pin_hash, 'return_minutes', return_minutes)
            from public.app_settings where id = 1)
    else null end;
$$;

-- Admin: change PIN (4–8 digits; null keeps it) and/or return minutes.
create or replace function public.set_tv_settings(p_pin text default null, p_return_minutes int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the administrator can change TV settings.'; end if;
  if p_pin is not null and p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'The PIN must be 4 to 8 digits.';
  end if;
  update public.app_settings
     set remote_pin_hash = case when p_pin is not null
                                then encode(sha256(convert_to('proview-pin:' || p_pin, 'UTF8')), 'hex')
                                else remote_pin_hash end,
         pin_is_default  = case when p_pin is not null then p_pin = '1234' else pin_is_default end,
         return_minutes  = coalesce(p_return_minutes, return_minutes),
         updated_at      = now()
   where id = 1;
  return (select jsonb_build_object('pin_is_default', pin_is_default, 'return_minutes', return_minutes, 'updated_at', updated_at)
            from public.app_settings where id = 1);
end;
$$;

revoke all on function public.get_tv_settings() from public, anon;
grant execute on function public.get_tv_settings() to authenticated;
revoke all on function public.set_tv_settings(text, int) from public, anon;
grant execute on function public.set_tv_settings(text, int) to authenticated;


-- ===== 005_client_site.sql =====
-- =====================================================================
--  PROVIEW SIGNAGE — site name & contact email for clients
--  Run after 004_tv_remote.sql. Safe to re-run.
-- =====================================================================

alter table public.clients add column if not exists site_name     text;
alter table public.clients add column if not exists contact_email text;

-- Clients created with an email as their name: keep it as the contact email.
update public.clients
   set contact_email = lower(trim(name))
 where contact_email is null and name ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';

-- whoami: include site name + contact email for the client picker.
create or replace function public.whoami()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id',  auth.uid(),
    'email',    auth.jwt() ->> 'email',
    'is_admin', public.is_admin(),
    'clients',  coalesce((
       select jsonb_agg(jsonb_build_object(
                'id', c.id, 'name', c.name, 'site_name', c.site_name, 'contact_email', c.contact_email,
                'role', case when public.is_admin() then coalesce(m.role, 'admin') else m.role end)
              order by lower(coalesce(nullif(c.site_name, ''), c.name)))
         from public.clients c
         left join public.client_members m on m.client_id = c.id and m.user_id = auth.uid()
        where public.is_admin() or m.user_id is not null), '[]'::jsonb)
  );
$$;

-- Invite page: show the site name if there is one.
create or replace function public.invite_info(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('client', coalesce(nullif(c.site_name, ''), c.name), 'email', i.email, 'role', i.role,
                            'used', i.accepted_at is not null)
    from public.invites i join public.clients c on c.id = i.client_id
   where i.token = p_token;
$$;


-- ===== 006_sites.sql =====
-- =====================================================================
--  PROVIEW SIGNAGE — multiple sites per client
--  Run after 005_client_site.sql. Safe to re-run.
--
--  A client (account) has many sites. Media, playlists and users are
--  shared across the client's sites; each TV belongs to one site.
-- =====================================================================

create table if not exists public.sites (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  name        text not null,
  address     text,
  created_at  timestamptz not null default now()
);
create index if not exists sites_client_idx on public.sites(client_id, name);

alter table public.screens add column if not exists site_id uuid references public.sites(id) on delete set null;
create index if not exists screens_site_idx on public.screens(site_id);

alter table public.sites enable row level security;
drop policy if exists sites_select on public.sites;
create policy sites_select on public.sites for select to authenticated
  using (public.is_member(client_id));
drop policy if exists sites_insert on public.sites;
create policy sites_insert on public.sites for insert to authenticated
  with check (public.is_member(client_id, array['manager']));
drop policy if exists sites_update on public.sites;
create policy sites_update on public.sites for update to authenticated
  using (public.is_member(client_id, array['manager']))
  with check (public.is_member(client_id, array['manager']));
drop policy if exists sites_delete on public.sites;
create policy sites_delete on public.sites for delete to authenticated
  using (public.is_member(client_id, array['manager']));

-- A TV's site must belong to the TV's client; moving a TV to another
-- client (or unpairing it) clears its site.
create or replace function public.screens_site_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.client_id is distinct from old.client_id then
    if new.site_id is not null and new.site_id is not distinct from old.site_id then
      new.site_id := null;
    end if;
  end if;
  if new.site_id is not null and not exists (
       select 1 from public.sites s where s.id = new.site_id and s.client_id = new.client_id) then
    raise exception 'That site belongs to a different client.';
  end if;
  return new;
end;
$$;
drop trigger if exists screens_site_guard on public.screens;
create trigger screens_site_guard before insert or update on public.screens
  for each row execute function public.screens_site_guard();

-- Earlier versions stored one "site name" on the client. Turn it into the
-- client's first site, and use it as the client's display name if the
-- client was named by its email address.
insert into public.sites (client_id, name)
select c.id, trim(c.site_name)
  from public.clients c
 where nullif(trim(c.site_name), '') is not null
   and not exists (select 1 from public.sites s where s.client_id = c.id);

update public.clients
   set name = trim(site_name)
 where nullif(trim(site_name), '') is not null
   and name ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';

-- Existing TVs of a client with exactly one site go into that site.
-- (one-off site assignment skipped)


-- ===== 007_features.sql =====
-- =====================================================================
--  PROVIEW SIGNAGE — feature pack
--  media folders · split-screen side playlists · emergency overrides ·
--  activity log · publish approvals · proof-of-play · TV screenshots
--  Run after 006_sites.sql. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Media folders
-- ---------------------------------------------------------------------
alter table public.media add column if not exists folder text;
create index if not exists media_folder_idx on public.media(client_id, folder);

-- ---------------------------------------------------------------------
--  Screen content: also include side-panel playlists used by layouts
-- ---------------------------------------------------------------------
create or replace function public._build_screen_content(p_screen uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.screens;
  ids uuid[];
begin
  select * into s from public.screens where id = p_screen;
  ids := array(
    select distinct x from (
      select s.default_playlist_id as x
      union all
      select playlist_id from public.schedule_items where screen_id = p_screen and enabled
    ) q where x is not null);
  if s.default_playlist_id is null and not exists
     (select 1 from public.schedule_items where screen_id = p_screen and enabled) then
    return null;
  end if;
  -- side panels referenced by those playlists' layouts
  ids := ids || array(
    select distinct (p.settings ->> 'side_playlist_id')::uuid
      from public.playlists p
     where p.id = any(ids) and p.client_id = s.client_id
       and coalesce(p.settings ->> 'side_playlist_id', '') ~ '^[0-9a-f-]{36}$');
  return jsonb_build_object(
    'version',  extract(epoch from clock_timestamp()),
    'default',  s.default_playlist_id,
    'schedule', coalesce((
       select jsonb_agg(jsonb_build_object(
                'id', i.id, 'label', i.label, 'playlist_id', i.playlist_id,
                'days', i.days, 'start_time', to_char(i.start_time, 'HH24:MI'),
                'end_time', to_char(i.end_time, 'HH24:MI'),
                'start_date', i.start_date, 'end_date', i.end_date, 'priority', i.priority)
              order by i.priority desc, i.created_at desc)
         from public.schedule_items i where i.screen_id = p_screen and i.enabled), '[]'::jsonb),
    'playlists', coalesce((
       select jsonb_object_agg(p.id, jsonb_build_object('name', p.name, 'slides', p.slides, 'settings', p.settings))
         from public.playlists p where p.id = any(ids) and p.client_id = s.client_id), '{}'::jsonb)
  );
end;
$$;
revoke all on function public._build_screen_content(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
--  Emergency overrides (all TVs / one client / one site)
-- ---------------------------------------------------------------------
create table if not exists public.overrides (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null check (scope in ('all', 'client', 'site')),
  client_id   uuid references public.clients(id) on delete cascade,
  site_id     uuid references public.sites(id) on delete cascade,
  message     text not null,
  subtitle    text,
  style       text not null default 'red' check (style in ('red', 'orange', 'blue', 'black', 'green')),
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  active      boolean not null default true,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  check ((scope = 'all' and client_id is null) or (scope = 'client' and client_id is not null) or (scope = 'site' and client_id is not null and site_id is not null))
);
create index if not exists overrides_active_idx on public.overrides(active, starts_at);
alter table public.overrides enable row level security;

drop policy if exists overrides_read on public.overrides;
create policy overrides_read on public.overrides for select to authenticated using (
  public.is_admin()
  or (client_id is not null and public.is_member(client_id))
  or exists (select 1 from public.screens s where s.device_user_id = auth.uid() and s.claimed
             and (overrides.scope = 'all'
                  or (overrides.scope = 'client' and s.client_id = overrides.client_id)
                  or (overrides.scope = 'site' and s.site_id = overrides.site_id))));
drop policy if exists overrides_write on public.overrides;
create policy overrides_write on public.overrides for all to authenticated
  using (public.is_admin() or (scope <> 'all' and client_id is not null and public.is_member(client_id)))
  with check (public.is_admin() or (scope <> 'all' and client_id is not null and public.is_member(client_id)));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'overrides') then
    alter publication supabase_realtime add table public.overrides;
  end if;
end $$;

-- ---------------------------------------------------------------------
--  Activity log
-- ---------------------------------------------------------------------
create table if not exists public.activity (
  id           bigserial primary key,
  client_id    uuid references public.clients(id) on delete cascade,
  user_id      uuid,
  email        text,
  action       text not null,
  entity       text not null,
  entity_id    text,
  entity_name  text,
  details      text,
  at           timestamptz not null default now()
);
create index if not exists activity_client_idx on public.activity(client_id, at desc);
alter table public.activity enable row level security;
drop policy if exists activity_read on public.activity;
create policy activity_read on public.activity for select to authenticated
  using (public.is_admin() or (client_id is not null and public.is_member(client_id)));

create or replace function public.log_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  act text := lower(tg_op) || 'd';
  ent text := tg_argv[0];
  cid uuid;
  nm text;
  det text := null;
  changed text[];
begin
  -- only log people, not TVs or background jobs
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return coalesce(new, old);
  end if;
  if act = 'insertd' then act := 'created'; elsif act = 'updated' then act := 'updated'; else act := 'deleted'; end if;

  cid := case when ent = 'client' then (r ->> 'id')::uuid else nullif(r ->> 'client_id', '')::uuid end;
  nm := coalesce(r ->> 'name', r ->> 'label', r ->> 'email', r ->> 'message');

  if tg_op = 'UPDATE' then
    select array_agg(k) into changed
      from jsonb_object_keys(r) k
     where r -> k is distinct from o -> k
       and k not in ('updated_at', 'last_seen', 'device_info', 'schedule_updated_at', 'hardware_id', 'pairing_code', 'created_at');
    if changed is null then return new; end if;
    if ent = 'screen' then
      if changed = array['content'] or changed <@ array['content', 'published_at'] then act := 'published'; det := null;
      elsif changed && array['license_type', 'license_expires_at'] then act := 'licence changed';
        det := coalesce(r ->> 'license_type', 'none') || coalesce(' until ' || to_char((r ->> 'license_expires_at')::timestamptz, 'DD Mon YYYY'), '');
      elsif changed <@ array['screenshot_requested_at', 'screenshot_at', 'screenshot_path', 'reload_at'] then return new;
      else det := array_to_string(changed, ', ');
      end if;
    elsif ent = 'playlist' then
      det := case when changed <@ array['slides'] then 'slides edited' else array_to_string(changed, ', ') end;
    else
      det := array_to_string(changed, ', ');
    end if;
    -- collapse rapid autosaves of the same thing by the same person
    if exists (select 1 from public.activity a where a.entity = ent and a.entity_id = r ->> 'id' and a.user_id = auth.uid()
                and a.action = act and a.at > now() - interval '10 minutes') then
      update public.activity set at = now(), details = det, entity_name = nm
       where id = (select id from public.activity a where a.entity = ent and a.entity_id = r ->> 'id' and a.user_id = auth.uid()
                    and a.action = act order by at desc limit 1);
      return new;
    end if;
  end if;

  insert into public.activity (client_id, user_id, email, action, entity, entity_id, entity_name, details)
  values (cid, auth.uid(), auth.jwt() ->> 'email', act, ent, r ->> 'id', nm, det);
  return coalesce(new, old);
exception when others then
  return coalesce(new, old);   -- never block the real change
end;
$$;

do $$
declare t text; e text;
begin
  for t, e in select * from (values ('playlists','playlist'), ('media','media'), ('schedule_items','schedule rule'), ('screens','screen'),
                                     ('sites','site'), ('clients','client'), ('invites','invite'), ('overrides','emergency message')) v(t, e)
  loop
    execute format('drop trigger if exists %I on public.%I', 'zz_activity_' || t, t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.log_activity(%L)', 'zz_activity_' || t, t, e);
  end loop;
end $$;

-- ---------------------------------------------------------------------
--  Publish approvals: editors' publishes wait for a manager
-- ---------------------------------------------------------------------
alter table public.clients add column if not exists require_approval boolean not null default false;

create table if not exists public.approval_requests (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  kind          text not null check (kind in ('screen', 'playlist')),
  target_id     uuid not null,
  target_name   text,
  note          text,
  requested_by  uuid default auth.uid() references auth.users(id) on delete set null,
  requested_email text default (auth.jwt() ->> 'email'),
  requested_at  timestamptz not null default now(),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by    uuid references auth.users(id) on delete set null,
  decided_at    timestamptz,
  decision_note text
);
create index if not exists approval_client_idx on public.approval_requests(client_id, status, requested_at desc);
alter table public.approval_requests enable row level security;
drop policy if exists approvals_read on public.approval_requests;
create policy approvals_read on public.approval_requests for select to authenticated using (public.is_member(client_id));
drop policy if exists approvals_insert on public.approval_requests;
create policy approvals_insert on public.approval_requests for insert to authenticated
  with check (public.is_member(client_id) and status = 'pending');

create or replace function public.needs_approval(p_client uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select require_approval from public.clients where id = p_client), false)
     and not public.is_member(p_client, array['manager']);
$$;

create or replace function public.publish_screen(p_screen uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s public.screens;
begin
  select * into s from public.screens where id = p_screen;
  if s.client_id is null or not public.is_member(s.client_id) then raise exception 'screen not found'; end if;
  if public.needs_approval(s.client_id) then raise exception 'APPROVAL_REQUIRED'; end if;
  if not public.license_ok(s.license_type, s.license_expires_at) then
    raise exception 'The licence for "%" has expired. Contact Proview to renew it.', s.name;
  end if;
  update public.screens set content = public._build_screen_content(p_screen), published_at = now() where id = p_screen;
end;
$$;

create or replace function public.publish_playlist(p_playlist uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  c uuid; n int := 0; sid uuid;
begin
  select client_id into c from public.playlists where id = p_playlist;
  if c is null or not public.is_member(c) then raise exception 'playlist not found'; end if;
  if public.needs_approval(c) then raise exception 'APPROVAL_REQUIRED'; end if;
  for sid in
    select id from public.screens
     where client_id = c and public.license_ok(license_type, license_expires_at)
       and (default_playlist_id = p_playlist
            or id in (select screen_id from public.schedule_items where playlist_id = p_playlist)
            or default_playlist_id in (select id from public.playlists where client_id = c and settings ->> 'side_playlist_id' = p_playlist::text)
            or id in (select si.screen_id from public.schedule_items si join public.playlists pp on pp.id = si.playlist_id
                       where pp.settings ->> 'side_playlist_id' = p_playlist::text))
  loop
    update public.screens set content = public._build_screen_content(sid), published_at = now() where id = sid;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Manager decides; approving publishes the current drafts.
create or replace function public.decide_approval(p_request uuid, p_approve boolean, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  r public.approval_requests;
  n int := 0;
  s public.screens;
  sid uuid;
begin
  select * into r from public.approval_requests where id = p_request for update;
  if not found or not public.is_member(r.client_id, array['manager']) then raise exception 'Only managers can approve.'; end if;
  if r.status <> 'pending' then raise exception 'This request was already %.', r.status; end if;
  if p_approve then
    if r.kind = 'screen' then
      select * into s from public.screens where id = r.target_id and client_id = r.client_id;
      if found and public.license_ok(s.license_type, s.license_expires_at) then
        update public.screens set content = public._build_screen_content(s.id), published_at = now() where id = s.id;
        n := 1;
      end if;
    else
      for sid in
        select id from public.screens
         where client_id = r.client_id and public.license_ok(license_type, license_expires_at)
           and (default_playlist_id = r.target_id or id in (select screen_id from public.schedule_items where playlist_id = r.target_id))
      loop
        update public.screens set content = public._build_screen_content(sid), published_at = now() where id = sid;
        n := n + 1;
      end loop;
    end if;
  end if;
  update public.approval_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = r.id;
  insert into public.activity (client_id, user_id, email, action, entity, entity_id, entity_name, details)
  values (r.client_id, auth.uid(), auth.jwt() ->> 'email', case when p_approve then 'approved' else 'rejected' end,
          'publish request', r.id::text, r.target_name, 'requested by ' || coalesce(r.requested_email, '?'));
  return n;
end;
$$;

create or replace function public.set_require_approval(p_client uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_client, array['manager']) then raise exception 'Only managers can change this.'; end if;
  update public.clients set require_approval = p_on where id = p_client;
end;
$$;

-- whoami: + require_approval
create or replace function public.whoami()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id',  auth.uid(),
    'email',    auth.jwt() ->> 'email',
    'is_admin', public.is_admin(),
    'clients',  coalesce((
       select jsonb_agg(jsonb_build_object(
                'id', c.id, 'name', c.name, 'contact_email', c.contact_email, 'require_approval', c.require_approval,
                'role', case when public.is_admin() then coalesce(m.role, 'admin') else m.role end)
              order by lower(c.name))
         from public.clients c
         left join public.client_members m on m.client_id = c.id and m.user_id = auth.uid()
        where public.is_admin() or m.user_id is not null), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------
--  Proof-of-play: TVs report hourly play counts per slide
-- ---------------------------------------------------------------------
create table if not exists public.play_stats (
  id           bigserial primary key,
  client_id    uuid not null references public.clients(id) on delete cascade,
  screen_id    uuid not null references public.screens(id) on delete cascade,
  site_id      uuid,
  hour         timestamptz not null,
  playlist_id  uuid,
  playlist_name text,
  slide_id     text not null,
  slide_name   text,
  slide_type   text,
  media_id     uuid,
  plays        int not null default 0,
  seconds      int not null default 0,
  unique (screen_id, hour, slide_id)
);
create index if not exists play_stats_client_idx on public.play_stats(client_id, hour);
alter table public.play_stats enable row level security;
drop policy if exists play_stats_read on public.play_stats;
create policy play_stats_read on public.play_stats for select to authenticated
  using (public.is_admin() or public.is_member(client_id));

create or replace function public.log_plays(p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  s public.screens;
  x jsonb;
  n int := 0;
begin
  select * into s from public.screens where device_user_id = auth.uid() and claimed and client_id is not null;
  if not found then return 0; end if;
  for x in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    insert into public.play_stats (client_id, screen_id, site_id, hour, playlist_id, playlist_name, slide_id, slide_name, slide_type, media_id, plays, seconds)
    values (s.client_id, s.id, s.site_id, date_trunc('hour', (x ->> 'hour')::timestamptz),
            nullif(x ->> 'playlist_id', '')::uuid, left(x ->> 'playlist_name', 200), left(x ->> 'slide_id', 80), left(x ->> 'slide_name', 200),
            left(x ->> 'slide_type', 20), nullif(x ->> 'media_id', '')::uuid,
            greatest(0, least(100000, (x ->> 'plays')::int)), greatest(0, least(3600 * 24, (x ->> 'seconds')::int)))
    on conflict (screen_id, hour, slide_id) do update
      set plays = play_stats.plays + excluded.plays, seconds = play_stats.seconds + excluded.seconds;
    n := n + 1;
  end loop;
  return n;
exception when others then
  return n;
end;
$$;
revoke all on function public.log_plays(jsonb) from public, anon;
grant execute on function public.log_plays(jsonb) to authenticated;

-- ---------------------------------------------------------------------
--  TV screenshots
-- ---------------------------------------------------------------------
alter table public.screens add column if not exists screenshot_requested_at timestamptz;
alter table public.screens add column if not exists screenshot_at timestamptz;
alter table public.screens add column if not exists screenshot_path text;
alter table public.screens add column if not exists screenshot_error text;

insert into storage.buckets (id, name, public, allowed_mime_types)
values ('screenshots', 'screenshots', false, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

drop policy if exists screenshots_tv_write on storage.objects;
create policy screenshots_tv_write on storage.objects for insert to authenticated
  with check (bucket_id = 'screenshots' and exists (
    select 1 from public.screens s where s.device_user_id = auth.uid() and storage.objects.name = s.id::text || '.jpg'));
drop policy if exists screenshots_tv_update on storage.objects;
create policy screenshots_tv_update on storage.objects for update to authenticated
  using (bucket_id = 'screenshots' and exists (
    select 1 from public.screens s where s.device_user_id = auth.uid() and storage.objects.name = s.id::text || '.jpg'));
drop policy if exists screenshots_tv_read on storage.objects;
create policy screenshots_tv_read on storage.objects for select to authenticated
  using (bucket_id = 'screenshots' and (
    exists (select 1 from public.screens s where s.device_user_id = auth.uid() and storage.objects.name = s.id::text || '.jpg')
    or exists (select 1 from public.screens s where storage.objects.name = s.id::text || '.jpg'
               and (public.is_admin() or (s.client_id is not null and public.is_member(s.client_id))))));

create or replace function public.screenshot_done(p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.screens
     set screenshot_at = case when p_ok then now() else screenshot_at end,
         screenshot_path = case when p_ok then id::text || '.jpg' else screenshot_path end,
         screenshot_error = case when p_ok then null else left(coalesce(p_error, 'Failed'), 200) end,
         screenshot_requested_at = null
   where device_user_id = auth.uid();
end;
$$;
revoke all on function public.screenshot_done(boolean, text) from public, anon;
grant execute on function public.screenshot_done(boolean, text) to authenticated;

-- Members may request a screenshot / reload (not protected by screens_guard).


-- ===== 008_alerts_payments.sql =====
-- =====================================================================
--  PROVIEW SIGNAGE — alerts (in-app + email) and online licence payments
--  Run after 007_features.sql. Safe to re-run.
--
--  A job runs every 5 minutes (pg_cron):
--    • TV offline / back online, licence ending in 14 / 3 days, expired
--      → notifications in the dashboard + emails via Resend (optional)
--    • Stripe Payment Links: paid checkouts extend the TV's licence
--  API keys are stored encrypted in Supabase Vault, entered by the admin.
-- =====================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------
--  Settings
-- ---------------------------------------------------------------------
alter table public.app_settings add column if not exists alerts_email_enabled  boolean not null default false;
alter table public.app_settings add column if not exists alert_offline_minutes int not null default 15;
alter table public.app_settings add column if not exists alerts_to_clients     boolean not null default false;
alter table public.app_settings add column if not exists admin_alert_email     text;
alter table public.app_settings add column if not exists email_from            text not null default 'PROVIEW SIGNAGE <onboarding@resend.dev>';
alter table public.app_settings add column if not exists stripe_enabled        boolean not null default false;
alter table public.app_settings add column if not exists stripe_plans          jsonb not null default '{}'::jsonb;
alter table public.app_settings add column if not exists stripe_last_created   bigint not null default 0;
alter table public.app_settings add column if not exists stripe_pending        bigint;
alter table public.app_settings add column if not exists stripe_last_error     text;
alter table public.app_settings add column if not exists stripe_checked_at     timestamptz;

alter table public.screens add column if not exists offline_since  timestamptz;
alter table public.screens add column if not exists license_notice text;

-- Clients can read the public parts of the payment settings (plans/links).
create or replace function public.get_payment_plans()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when stripe_enabled then stripe_plans else '{}'::jsonb end from public.app_settings where id = 1;
$$;
grant execute on function public.get_payment_plans() to authenticated;

-- ---------------------------------------------------------------------
--  Notifications
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id          bigserial primary key,
  client_id   uuid references public.clients(id) on delete cascade,
  screen_id   uuid references public.screens(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  created_at  timestamptz not null default now(),
  emailed     boolean not null default false
);
create index if not exists notifications_idx on public.notifications(client_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
  using (public.is_admin() or (client_id is not null and public.is_member(client_id)));

-- ---------------------------------------------------------------------
--  Vault helpers (admin only)
-- ---------------------------------------------------------------------
create or replace function public._secret(p_name text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v using p_name;
  return v;
exception when others then return null;
end;
$$;
revoke all on function public._secret(text) from public, anon, authenticated;

create or replace function public._set_secret(p_name text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  execute 'select id from vault.secrets where name = $1 limit 1' into sid using p_name;
  if p_value is null or p_value = '' then
    if sid is not null then execute 'delete from vault.secrets where id = $1' using sid; end if;
  elsif sid is null then
    execute 'select vault.create_secret($1, $2)' using p_value, p_name;
  else
    execute 'select vault.update_secret($1, $2)' using sid, p_value;
  end if;
end;
$$;
revoke all on function public._set_secret(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
--  Email (Resend)
-- ---------------------------------------------------------------------
create or replace function public._send_email(p_to text[], p_subject text, p_html text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare
  k text := public._secret('resend_api_key');
  f text := (select email_from from public.app_settings where id = 1);
begin
  if k is null or p_to is null or array_length(p_to, 1) is null then return false; end if;
  perform net.http_post(
    url := 'https://api.resend.com/emails',
    body := jsonb_build_object('from', f, 'to', to_jsonb(p_to), 'subject', p_subject, 'html', p_html),
    headers := jsonb_build_object('Authorization', 'Bearer ' || k, 'Content-Type', 'application/json'));
  return true;
exception when others then return false;
end;
$$;
revoke all on function public._send_email(text[], text, text) from public, anon, authenticated;

create or replace function public._email_html(p_title text, p_body text)
returns text language sql immutable as $$
  select '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;padding:24px">'
      || '<div style="font-weight:800;letter-spacing:.06em;margin-bottom:18px">PROVIEW <span style="color:#ff5a1f;font-weight:500">SIGNAGE</span></div>'
      || '<h2 style="margin:0 0 10px;font-size:20px">' || replace(replace(p_title, '<', '&lt;'), '>', '&gt;') || '</h2>'
      || '<p style="color:#444;line-height:1.5;margin:0">' || replace(replace(coalesce(p_body, ''), '<', '&lt;'), '>', '&gt;') || '</p>'
      || '<p style="color:#999;font-size:12px;margin-top:28px">Automatic alert from PROVIEW SIGNAGE.</p></div>';
$$;

-- ---------------------------------------------------------------------
--  The 5-minute check
-- ---------------------------------------------------------------------
create or replace function public.check_alerts()
returns int language plpgsql security definer set search_path = public as $$
declare
  st public.app_settings;
  r record;
  n int := 0;
  days int;
  stage text;
  place text;
  rcpt text[];
begin
  select * into st from public.app_settings where id = 1;

  for r in
    select s.*, c.name as client_name, si.name as site_name
      from public.screens s
      join public.clients c on c.id = s.client_id
      left join public.sites si on si.id = s.site_id
     where s.claimed
  loop
    place := concat_ws(' · ', r.client_name, r.site_name, r.location);

    -- offline / back online (only for TVs that are licensed)
    if public.license_ok(r.license_type, r.license_expires_at) then
      if r.offline_since is null and r.last_seen < now() - make_interval(mins => st.alert_offline_minutes) then
        insert into public.notifications (client_id, screen_id, kind, title, body)
        values (r.client_id, r.id, 'offline', r.name || ' is offline',
                'Not seen since ' || to_char(r.last_seen at time zone 'Europe/London', 'HH24:MI DD Mon') || '. ' || place || '. Check the TV is on and connected to the internet.');
        update public.screens set offline_since = now() where id = r.id;
        n := n + 1;
      elsif r.offline_since is not null and r.last_seen > r.offline_since then
        insert into public.notifications (client_id, screen_id, kind, title, body)
        values (r.client_id, r.id, 'online', r.name || ' is back online', place || '.');
        update public.screens set offline_since = null where id = r.id;
        n := n + 1;
      end if;
    end if;

    -- licence reminders
    if r.license_type is not null and r.license_type <> 'lifetime' and r.license_expires_at is not null then
      days := ceil(extract(epoch from r.license_expires_at - now()) / 86400)::int;
      stage := case when days <= 0 then 'expired' when days <= 3 then '3d' when days <= 14 then '14d' else null end;
      if stage is null and r.license_notice is not null then
        update public.screens set license_notice = null where id = r.id;
      elsif stage is not null and coalesce(r.license_notice, '') <> stage
            and coalesce(r.license_notice, '') <> 'expired' and not (coalesce(r.license_notice, '') = '3d' and stage = '14d') then
        insert into public.notifications (client_id, screen_id, kind, title, body)
        values (r.client_id, r.id, 'licence_' || stage,
                case stage when 'expired' then 'Licence expired: ' || r.name
                           else 'Licence ends in ' || days || ' day' || case when days = 1 then '' else 's' end || ': ' || r.name end,
                case when r.license_type = 'trial7' then 'Free trial' else 'Licence' end || ' for ' || r.name || ' (' || place || ') '
                  || case stage when 'expired' then 'ended on ' else 'ends on ' end || to_char(r.license_expires_at, 'DD Mon YYYY')
                  || case stage when 'expired' then '. The screen keeps playing for 7 days, then stops.' else '. Renew to avoid interruption.' end);
        update public.screens set license_notice = stage where id = r.id;
        n := n + 1;
      end if;
    end if;
  end loop;

  -- emails for new notifications
  if st.alerts_email_enabled then
    for r in select nt.*, c.contact_email from public.notifications nt left join public.clients c on c.id = nt.client_id
              where not nt.emailed and nt.created_at > now() - interval '1 day' order by nt.id limit 50
    loop
      rcpt := array(select distinct e from (
                select p.email as e from public.profiles p where p.is_admin and p.email is not null
                union select st.admin_alert_email where st.admin_alert_email is not null
                union select r.contact_email where st.alerts_to_clients and r.contact_email is not null
                union select p.email from public.client_members m join public.profiles p on p.id = m.user_id
                       where st.alerts_to_clients and m.client_id = r.client_id and m.role = 'manager'
              ) x where e is not null and e <> '');
      perform public._send_email(rcpt, r.title, public._email_html(r.title, r.body));
      update public.notifications set emailed = true where id = r.id;
    end loop;
  else
    update public.notifications set emailed = true where not emailed;
  end if;

  perform public.check_payments();
  return n;
end;
$$;
revoke all on function public.check_alerts() from public, anon, authenticated;

-- ---------------------------------------------------------------------
--  Stripe Payment Links → licences
--  Each plan has a Payment Link. The dashboard opens it with
--  ?client_reference_id=<screen-id>__<plan>. Every 5 minutes we read
--  recent paid Checkout Sessions (restricted key: Checkout Sessions read)
--  and extend licences when the amount paid matches the plan.
-- ---------------------------------------------------------------------
create table if not exists public.payments (
  session_id    text primary key,
  screen_id     uuid references public.screens(id) on delete set null,
  client_id     uuid references public.clients(id) on delete set null,
  license_type  text,
  amount        int,
  currency      text,
  email         text,
  paid_at       timestamptz not null default now(),
  applied       boolean not null default false,
  note          text
);
alter table public.payments enable row level security;
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments for select to authenticated
  using (public.is_admin() or (client_id is not null and public.is_member(client_id, array['manager'])));

create or replace function public.check_payments()
returns int language plpgsql security definer set search_path = public, extensions as $$
declare
  st public.app_settings;
  k text;
  resp record;
  x jsonb;
  ref text; scr uuid; plan text; p jsonb;
  s public.screens;
  base timestamptz;
  n int := 0;
  maxc bigint;
begin
  select * into st from public.app_settings where id = 1;
  if not st.stripe_enabled then return 0; end if;
  k := public._secret('stripe_secret_key');
  if k is null then return 0; end if;

  -- 1) read the previous request's response
  if st.stripe_pending is not null then
    select * into resp from net._http_response where id = st.stripe_pending;
    if found then
      if resp.status_code = 200 then
        maxc := st.stripe_last_created;
        for x in select * from jsonb_array_elements(coalesce(resp.content::jsonb -> 'data', '[]'::jsonb)) loop
          maxc := greatest(maxc, (x ->> 'created')::bigint);
          continue when x ->> 'payment_status' <> 'paid';
          ref := x ->> 'client_reference_id';
          continue when ref is null or ref !~ '^[0-9a-f-]{36}__[a-z0-9]+$';
          scr := split_part(ref, '__', 1)::uuid; plan := split_part(ref, '__', 2);
          p := st.stripe_plans -> plan;
          insert into public.payments (session_id, screen_id, license_type, amount, currency, email, note)
          values (x ->> 'id', scr, plan, (x ->> 'amount_total')::int, x ->> 'currency', x -> 'customer_details' ->> 'email', null)
          on conflict (session_id) do nothing;
          continue when not found;
          select * into s from public.screens where id = scr;
          if s.id is null or p is null then
            update public.payments set note = 'Unknown screen or plan' where session_id = x ->> 'id'; continue;
          end if;
          update public.payments set client_id = s.client_id where session_id = x ->> 'id';
          if (x ->> 'amount_total')::int < coalesce((p ->> 'amount')::int, 0) or lower(x ->> 'currency') <> lower(coalesce(p ->> 'currency', 'gbp')) then
            update public.payments set note = 'Amount does not match the plan; not applied' where session_id = x ->> 'id'; continue;
          end if;
          if plan = 'lifetime' then
            update public.screens set license_type = 'lifetime', license_expires_at = null, license_updated_at = now(),
                   license_notes = 'Paid online ' || to_char(now(), 'DD Mon YYYY') where id = scr;
          else
            base := case when s.license_expires_at is not null and s.license_expires_at > now() and s.license_type <> 'lifetime' then s.license_expires_at else now() end;
            update public.screens set license_type = plan, license_starts_at = coalesce(license_starts_at, now()),
                   license_expires_at = base + public.license_interval(plan), license_updated_at = now(),
                   license_notes = 'Paid online ' || to_char(now(), 'DD Mon YYYY') where id = scr;
          end if;
          update public.payments set applied = true where session_id = x ->> 'id';
          insert into public.notifications (client_id, screen_id, kind, title, body)
          values (s.client_id, s.id, 'payment', 'Payment received: ' || s.name,
                  'Licence renewed online (' || plan || '). Paid ' || upper(x ->> 'currency') || ' ' || to_char((x ->> 'amount_total')::numeric / 100, 'FM999990.00') || '.');
          n := n + 1;
        end loop;
        update public.app_settings set stripe_last_created = greatest(maxc - 3600, stripe_last_created), stripe_last_error = null where id = 1;
      else
        update public.app_settings set stripe_last_error = 'Stripe said ' || resp.status_code || ': ' || left(coalesce(resp.content, ''), 200) where id = 1;
      end if;
      update public.app_settings set stripe_pending = null where id = 1;
    end if;
  end if;

  -- 2) ask for recent sessions (answer is read on the next run)
  if (select stripe_pending from public.app_settings where id = 1) is null then
    update public.app_settings
       set stripe_pending = net.http_get(
             url := 'https://api.stripe.com/v1/checkout/sessions?limit=100&created[gte]=' ||
                    greatest(st.stripe_last_created, extract(epoch from now() - interval '30 days')::bigint),
             headers := jsonb_build_object('Authorization', 'Bearer ' || k)),
           stripe_checked_at = now()
     where id = 1;
  end if;
  return n;
exception when others then
  update public.app_settings set stripe_last_error = left(sqlerrm, 200), stripe_pending = null where id = 1;
  return n;
end;
$$;
revoke all on function public.check_payments() from public, anon, authenticated;

-- ---------------------------------------------------------------------
--  Admin settings RPCs
-- ---------------------------------------------------------------------
create or replace function public.get_integration_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare st public.app_settings;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select * into st from public.app_settings where id = 1;
  return jsonb_build_object(
    'alerts_email_enabled', st.alerts_email_enabled, 'alert_offline_minutes', st.alert_offline_minutes,
    'alerts_to_clients', st.alerts_to_clients, 'admin_alert_email', st.admin_alert_email, 'email_from', st.email_from,
    'has_resend_key', public._secret('resend_api_key') is not null,
    'stripe_enabled', st.stripe_enabled, 'stripe_plans', st.stripe_plans, 'has_stripe_key', public._secret('stripe_secret_key') is not null,
    'stripe_last_error', st.stripe_last_error, 'stripe_checked_at', st.stripe_checked_at,
    'cron', (select count(*) from cron.job where jobname = 'signage-alerts') > 0);
exception when undefined_table then
  return jsonb_build_object('error', 'cron not available');
end;
$$;
grant execute on function public.get_integration_settings() to authenticated;

create or replace function public.set_integration_settings(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if p ? 'resend_api_key' then perform public._set_secret('resend_api_key', nullif(trim(p ->> 'resend_api_key'), '')); end if;
  if p ? 'stripe_secret_key' then perform public._set_secret('stripe_secret_key', nullif(trim(p ->> 'stripe_secret_key'), '')); end if;
  update public.app_settings set
    alerts_email_enabled  = coalesce((p ->> 'alerts_email_enabled')::boolean, alerts_email_enabled),
    alert_offline_minutes = coalesce((p ->> 'alert_offline_minutes')::int, alert_offline_minutes),
    alerts_to_clients     = coalesce((p ->> 'alerts_to_clients')::boolean, alerts_to_clients),
    admin_alert_email     = case when p ? 'admin_alert_email' then nullif(trim(p ->> 'admin_alert_email'), '') else admin_alert_email end,
    email_from            = coalesce(nullif(trim(p ->> 'email_from'), ''), email_from),
    stripe_enabled        = coalesce((p ->> 'stripe_enabled')::boolean, stripe_enabled),
    stripe_plans          = coalesce(p -> 'stripe_plans', stripe_plans),
    updated_at            = now()
  where id = 1;
end;
$$;
grant execute on function public.set_integration_settings(jsonb) to authenticated;

create or replace function public.send_test_email()
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if public._secret('resend_api_key') is null then raise exception 'Add your Resend API key first.'; end if;
  return public._send_email(array[coalesce((select admin_alert_email from public.app_settings where id = 1), auth.jwt() ->> 'email')],
    'PROVIEW SIGNAGE test email', public._email_html('Email alerts are working', 'You will get emails like this when a TV goes offline or a licence is about to end.'));
end;
$$;
grant execute on function public.send_test_email() to authenticated;

-- ---------------------------------------------------------------------
--  Schedule the job every 5 minutes
-- ---------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('signage-alerts') where exists (select 1 from cron.job where jobname = 'signage-alerts');
  perform cron.schedule('signage-alerts', '*/5 * * * *', 'select public.check_alerts()');
exception when others then
  raise notice 'Could not schedule job: %', sqlerrm;
end $$;


-- ===== 009_add_on_playlists.sql =====
-- =====================================================================
--  PROVIEW SIGNAGE — "add on" playlists
--  A TV can play extra playlists after its default one, in a loop.
--  Run after 008_alerts_payments.sql. Safe to re-run.
-- =====================================================================

alter table public.screens add column if not exists also_playlist_ids uuid[] not null default '{}';

create or replace function public._build_screen_content(p_screen uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.screens;
  ids uuid[];
  also uuid[];
begin
  select * into s from public.screens where id = p_screen;
  -- keep only add-ons that still exist and belong to this client
  also := array(select x from unnest(coalesce(s.also_playlist_ids, '{}')) with ordinality u(x, n)
                 where exists (select 1 from public.playlists p where p.id = u.x and p.client_id = s.client_id)
                   and u.x is distinct from s.default_playlist_id
                 order by n);
  ids := array(
    select distinct x from (
      select s.default_playlist_id as x
      union all select unnest(also)
      union all select playlist_id from public.schedule_items where screen_id = p_screen and enabled
    ) q where x is not null);
  if s.default_playlist_id is null and coalesce(array_length(also, 1), 0) = 0 and not exists
     (select 1 from public.schedule_items where screen_id = p_screen and enabled) then
    return null;
  end if;
  ids := ids || array(
    select distinct (p.settings ->> 'side_playlist_id')::uuid
      from public.playlists p
     where p.id = any(ids) and p.client_id = s.client_id
       and coalesce(p.settings ->> 'side_playlist_id', '') ~ '^[0-9a-f-]{36}$');
  return jsonb_build_object(
    'version',  extract(epoch from clock_timestamp()),
    'default',  s.default_playlist_id,
    'also',     to_jsonb(also),
    'schedule', coalesce((
       select jsonb_agg(jsonb_build_object(
                'id', i.id, 'label', i.label, 'playlist_id', i.playlist_id,
                'days', i.days, 'start_time', to_char(i.start_time, 'HH24:MI'),
                'end_time', to_char(i.end_time, 'HH24:MI'),
                'start_date', i.start_date, 'end_date', i.end_date, 'priority', i.priority)
              order by i.priority desc, i.created_at desc)
         from public.schedule_items i where i.screen_id = p_screen and i.enabled), '[]'::jsonb),
    'playlists', coalesce((
       select jsonb_object_agg(p.id, jsonb_build_object('name', p.name, 'slides', p.slides, 'settings', p.settings))
         from public.playlists p where p.id = any(ids) and p.client_id = s.client_id), '{}'::jsonb)
  );
end;
$$;
revoke all on function public._build_screen_content(uuid) from public, anon, authenticated;

-- Publishing a playlist also updates TVs that play it as an add-on.
create or replace function public.publish_playlist(p_playlist uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  c uuid; n int := 0; sid uuid;
begin
  select client_id into c from public.playlists where id = p_playlist;
  if c is null or not public.is_member(c) then raise exception 'playlist not found'; end if;
  if public.needs_approval(c) then raise exception 'APPROVAL_REQUIRED'; end if;
  for sid in
    select id from public.screens
     where client_id = c and public.license_ok(license_type, license_expires_at)
       and (default_playlist_id = p_playlist
            or p_playlist = any(also_playlist_ids)
            or id in (select screen_id from public.schedule_items where playlist_id = p_playlist)
            or default_playlist_id in (select id from public.playlists where client_id = c and settings ->> 'side_playlist_id' = p_playlist::text)
            or id in (select si.screen_id from public.schedule_items si join public.playlists pp on pp.id = si.playlist_id
                       where pp.settings ->> 'side_playlist_id' = p_playlist::text))
  loop
    update public.screens set content = public._build_screen_content(sid), published_at = now() where id = sid;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Deleting a playlist removes it from TVs' add-on lists.
create or replace function public.playlists_cleanup_addons()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.screens set also_playlist_ids = array_remove(also_playlist_ids, old.id)
   where old.id = any(also_playlist_ids);
  return old;
end;
$$;
drop trigger if exists playlists_cleanup_addons on public.playlists;
create trigger playlists_cleanup_addons after delete on public.playlists
  for each row execute function public.playlists_cleanup_addons();


-- ===== 010_fixes.sql =====
-- 010: bug fixes found in the site-wide check
--  * approving an editor's playlist change now reaches every TV using it
--    (add-ons and side panels too), same as Publish
--  * changing a TV's add-on playlists marks it as having unpublished changes
--  * moving / unpairing a TV clears its old add-on playlists
--  * editors at clients that require approval can't bypass it with emergency messages

-- One place that decides which TVs use a playlist.
create or replace function public._screens_using_playlist(p_client uuid, p_playlist uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from public.screens
   where client_id = p_client and public.license_ok(license_type, license_expires_at)
     and (default_playlist_id = p_playlist
          or p_playlist = any(also_playlist_ids)
          or id in (select screen_id from public.schedule_items where playlist_id = p_playlist)
          or default_playlist_id in (select id from public.playlists where client_id = p_client and settings ->> 'side_playlist_id' = p_playlist::text)
          or id in (select si.screen_id from public.schedule_items si join public.playlists pp on pp.id = si.playlist_id
                     where pp.settings ->> 'side_playlist_id' = p_playlist::text));
$$;
revoke all on function public._screens_using_playlist(uuid, uuid) from public, anon, authenticated;

create or replace function public.publish_playlist(p_playlist uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  c uuid; n int := 0; sid uuid;
begin
  select client_id into c from public.playlists where id = p_playlist;
  if c is null or not public.is_member(c) then raise exception 'playlist not found'; end if;
  if public.needs_approval(c) then raise exception 'APPROVAL_REQUIRED'; end if;
  for sid in select * from public._screens_using_playlist(c, p_playlist) loop
    update public.screens set content = public._build_screen_content(sid), published_at = now() where id = sid;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.decide_approval(p_request uuid, p_approve boolean, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  r public.approval_requests;
  n int := 0;
  s public.screens;
  sid uuid;
begin
  select * into r from public.approval_requests where id = p_request for update;
  if not found or not public.is_member(r.client_id, array['manager']) then raise exception 'Only managers can approve.'; end if;
  if r.status <> 'pending' then raise exception 'This request was already %.', r.status; end if;
  if p_approve then
    if r.kind = 'screen' then
      select * into s from public.screens where id = r.target_id and client_id = r.client_id;
      if found and public.license_ok(s.license_type, s.license_expires_at) then
        update public.screens set content = public._build_screen_content(s.id), published_at = now() where id = s.id;
        n := 1;
      end if;
    else
      for sid in select * from public._screens_using_playlist(r.client_id, r.target_id) loop
        update public.screens set content = public._build_screen_content(sid), published_at = now() where id = sid;
        n := n + 1;
      end loop;
    end if;
  end if;
  update public.approval_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = r.id;
  insert into public.activity (client_id, user_id, email, action, entity, entity_id, entity_name, details)
  values (r.client_id, auth.uid(), auth.jwt() ->> 'email', case when p_approve then 'approved' else 'rejected' end,
          'publish request', r.id::text, r.target_name, 'requested by ' || coalesce(r.requested_email, '?'));
  return n;
end;
$$;

-- Add-on changes count as schedule changes ("Unpublished changes" badge).
create or replace function public.screens_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    null;
  elsif not public.is_admin() then
    if new.client_id is distinct from old.client_id
       or new.device_user_id is distinct from old.device_user_id
       or new.claimed is distinct from old.claimed
       or new.content is distinct from old.content
       or new.pairing_code is distinct from old.pairing_code
       or new.hardware_id is distinct from old.hardware_id
       or new.trial_blocked_reason is distinct from old.trial_blocked_reason
       or new.license_type is distinct from old.license_type
       or new.license_starts_at is distinct from old.license_starts_at
       or new.license_expires_at is distinct from old.license_expires_at
       or new.license_notes is distinct from old.license_notes
       or new.license_updated_at is distinct from old.license_updated_at then
      raise exception 'not allowed to change those screen fields';
    end if;
  end if;
  if new.default_playlist_id is distinct from old.default_playlist_id then
    if new.default_playlist_id is not null and not exists (
      select 1 from public.playlists p where p.id = new.default_playlist_id and p.client_id = new.client_id) then
      raise exception 'playlist belongs to a different client';
    end if;
    new.schedule_updated_at := now();
  end if;
  if new.also_playlist_ids is distinct from old.also_playlist_ids then
    new.schedule_updated_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.assign_screen(p_screen uuid, p_client uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  delete from public.schedule_items where screen_id = p_screen;
  update public.screens
     set client_id = p_client, default_playlist_id = null, also_playlist_ids = '{}', content = null,
         published_at = now(), schedule_updated_at = null
   where id = p_screen;
end;
$$;

create or replace function public.unpair_screen(p_screen uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c uuid;
begin
  select client_id into c from public.screens where id = p_screen;
  if not found then raise exception 'screen not found'; end if;
  if not (public.is_admin() or (c is not null and public.is_member(c, array['manager']))) then
    raise exception 'not allowed';
  end if;
  delete from public.schedule_items where screen_id = p_screen;
  update public.screens
     set claimed = false, client_id = null, default_playlist_id = null, also_playlist_ids = '{}', content = null,
         published_at = null, schedule_updated_at = null, name = 'New screen', location = null,
         pairing_code = public.gen_pairing_code(), created_at = now()
   where id = p_screen;
end;
$$;

-- Emergency messages: editors only when their client doesn't require approval.
drop policy if exists overrides_write on public.overrides;
create policy overrides_write on public.overrides for all to authenticated
  using (public.is_admin() or (scope <> 'all' and client_id is not null and public.is_member(client_id) and not public.needs_approval(client_id)))
  with check (public.is_admin() or (scope <> 'all' and client_id is not null and public.is_member(client_id) and not public.needs_approval(client_id)));


-- ===== 011_invite_email.sql =====
-- 011: send invites by email straight from PROVIEW SIGNAGE (via Resend)

alter table public.app_settings add column if not exists app_url text not null default 'https://app.proviewsignage.co.uk/';
alter table public.invites add column if not exists emailed_at timestamptz;

-- Emails now come from the verified proviewsignage.co.uk domain.
update public.app_settings set email_from = 'PROVIEW SIGNAGE <noreply@proviewsignage.co.uk>'
 where id = 1 and email_from ilike '%onboarding@resend.dev%';

create or replace function public._esc(t text) returns text language sql immutable as $$
  select replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');
$$;

-- Alert emails: blue brand colour.
create or replace function public._email_html(p_title text, p_body text)
returns text language sql immutable as $$
  select '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;padding:24px">'
      || '<div style="font-weight:800;letter-spacing:.06em;margin-bottom:18px">PROVIEW <span style="color:#4a6cd0;font-weight:500">SIGNAGE</span></div>'
      || '<h2 style="margin:0 0 10px;font-size:20px">' || public._esc(p_title) || '</h2>'
      || '<p style="color:#444;line-height:1.5;margin:0">' || public._esc(p_body) || '</p>'
      || '<p style="color:#999;font-size:12px;margin-top:28px">Automatic alert from PROVIEW SIGNAGE · www.proviewsignage.co.uk · 020 8935 5495</p></div>';
$$;

create or replace function public.send_invite_email(p_invite uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  i public.invites;
  cname text;
  inviter text := coalesce(auth.jwt() ->> 'email', 'PROVIEW SIGNAGE');
  link text;
  html text;
begin
  select * into i from public.invites where id = p_invite;
  if not found then raise exception 'Invite not found.'; end if;
  if not (public.is_admin() or public.is_member(i.client_id, array['manager'])) then raise exception 'Only managers can send invites.'; end if;
  if i.accepted_at is not null then raise exception 'This invite has already been accepted.'; end if;
  if public._secret('resend_api_key') is null then
    raise exception 'Email sending isn''t set up yet. An admin needs to add the Resend API key in Clients & TVs → Alerts & email. Meanwhile, copy the link and send it yourself.';
  end if;
  select coalesce(nullif(site_name, ''), name) into cname from public.clients where id = i.client_id;
  link := rtrim((select app_url from public.app_settings where id = 1), '/') || '/#/join/' || i.token;
  html := '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;padding:28px 24px;color:#17171c">'
    || '<div style="font-weight:800;letter-spacing:.06em;margin-bottom:22px">PROVIEW <span style="color:#4a6cd0;font-weight:500">SIGNAGE</span></div>'
    || '<h2 style="margin:0 0 12px;font-size:22px">You''re invited to manage ' || public._esc(cname) || '’s screens</h2>'
    || '<p style="color:#444;line-height:1.55;margin:0 0 22px">' || public._esc(inviter) || ' has given you <b>'
    || case when i.role = 'manager' then 'manager' else 'editor' end
    || '</b> access to the digital signage for <b>' || public._esc(cname) || '</b>. '
    || 'Create your account with this email address (' || public._esc(i.email) || ') to get started.</p>'
    || '<a href="' || public._esc(link) || '" style="display:inline-block;background:#3d73d3;background-image:linear-gradient(135deg,#2f84d4,#5a5fbb);color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px">Accept invite</a>'
    || '<p style="color:#888;font-size:13px;line-height:1.5;margin:22px 0 0">Or open this link: <br><a href="' || public._esc(link) || '" style="color:#3d73d3;word-break:break-all">' || public._esc(link) || '</a></p>'
    || '<p style="color:#999;font-size:12px;margin-top:30px;border-top:1px solid #eee;padding-top:14px">PROVIEW SIGNAGE · www.proviewsignage.co.uk · Support 020 8935 5495</p></div>';
  if not public._send_email(array[i.email], 'You''re invited to ' || cname || ' on PROVIEW SIGNAGE', html) then
    raise exception 'The email could not be sent. Copy the link and send it yourself.';
  end if;
  update public.invites set emailed_at = now() where id = i.id;
  return true;
end;
$$;
revoke all on function public.send_invite_email(uuid) from public, anon;
grant execute on function public.send_invite_email(uuid) to authenticated;


-- ===== 012_rule_day_times.sql =====
-- 012: TV / site schedule rules can have different times on each day.
--  day_times = { "1": {"from":"09:00","to":"17:00"}, "2": {...}, ... }  (0=Sun … 6=Sat)
--  null = the rule's start_time/end_time apply to every chosen day (as before).

alter table public.schedule_items add column if not exists day_times jsonb;

create or replace function public._build_screen_content(p_screen uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.screens;
  ids uuid[];
  also uuid[];
begin
  select * into s from public.screens where id = p_screen;
  -- keep only add-ons that still exist and belong to this client
  also := array(select x from unnest(coalesce(s.also_playlist_ids, '{}')) with ordinality u(x, n)
                 where exists (select 1 from public.playlists p where p.id = u.x and p.client_id = s.client_id)
                   and u.x is distinct from s.default_playlist_id
                 order by n);
  ids := array(
    select distinct x from (
      select s.default_playlist_id as x
      union all select unnest(also)
      union all select playlist_id from public.schedule_items where screen_id = p_screen and enabled
    ) q where x is not null);
  if s.default_playlist_id is null and coalesce(array_length(also, 1), 0) = 0 and not exists
     (select 1 from public.schedule_items where screen_id = p_screen and enabled) then
    return null;
  end if;
  ids := ids || array(
    select distinct (p.settings ->> 'side_playlist_id')::uuid
      from public.playlists p
     where p.id = any(ids) and p.client_id = s.client_id
       and coalesce(p.settings ->> 'side_playlist_id', '') ~ '^[0-9a-f-]{36}$');
  return jsonb_build_object(
    'version',  extract(epoch from clock_timestamp()),
    'default',  s.default_playlist_id,
    'also',     to_jsonb(also),
    'schedule', coalesce((
       select jsonb_agg(jsonb_build_object(
                'id', i.id, 'label', i.label, 'playlist_id', i.playlist_id,
                'days', i.days, 'start_time', to_char(i.start_time, 'HH24:MI'),
                'end_time', to_char(i.end_time, 'HH24:MI'),
                'start_date', i.start_date, 'end_date', i.end_date, 'priority', i.priority,
                'day_times', i.day_times)
              order by i.priority desc, i.created_at desc)
         from public.schedule_items i where i.screen_id = p_screen and i.enabled), '[]'::jsonb),
    'playlists', coalesce((
       select jsonb_object_agg(p.id, jsonb_build_object('name', p.name, 'slides', p.slides, 'settings', p.settings))
         from public.playlists p where p.id = any(ids) and p.client_id = s.client_id), '{}'::jsonb)
  );
end;
$$;
revoke all on function public._build_screen_content(uuid) from public, anon, authenticated;


-- ===== 013_layout_zones.sql =====
-- 013: split-screen layouts. A playlist's settings.zones = [playlist for area 2, area 3, area 4].
--  TVs receive those playlists too, and publishing one of them updates TVs that show it in an area.

create or replace function public._build_screen_content(p_screen uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.screens;
  ids uuid[];
  also uuid[];
begin
  select * into s from public.screens where id = p_screen;
  -- keep only add-ons that still exist and belong to this client
  also := array(select x from unnest(coalesce(s.also_playlist_ids, '{}')) with ordinality u(x, n)
                 where exists (select 1 from public.playlists p where p.id = u.x and p.client_id = s.client_id)
                   and u.x is distinct from s.default_playlist_id
                 order by n);
  ids := array(
    select distinct x from (
      select s.default_playlist_id as x
      union all select unnest(also)
      union all select playlist_id from public.schedule_items where screen_id = p_screen and enabled
    ) q where x is not null);
  if s.default_playlist_id is null and coalesce(array_length(also, 1), 0) = 0 and not exists
     (select 1 from public.schedule_items where screen_id = p_screen and enabled) then
    return null;
  end if;
  -- playlists shown in the other areas of a split-screen layout (and the old side panel)
  ids := ids || array(
    select distinct z.v::uuid
      from public.playlists p
      cross join lateral (
        select p.settings ->> 'side_playlist_id' as v
        union all
        select jsonb_array_elements_text(case when jsonb_typeof(p.settings -> 'zones') = 'array' then p.settings -> 'zones' else '[]'::jsonb end)
      ) z
     where p.id = any(ids) and p.client_id = s.client_id
       and coalesce(z.v, '') ~ '^[0-9a-f-]{36}$');
  return jsonb_build_object(
    'version',  extract(epoch from clock_timestamp()),
    'default',  s.default_playlist_id,
    'also',     to_jsonb(also),
    'schedule', coalesce((
       select jsonb_agg(jsonb_build_object(
                'id', i.id, 'label', i.label, 'playlist_id', i.playlist_id,
                'days', i.days, 'start_time', to_char(i.start_time, 'HH24:MI'),
                'end_time', to_char(i.end_time, 'HH24:MI'),
                'start_date', i.start_date, 'end_date', i.end_date, 'priority', i.priority,
                'day_times', i.day_times)
              order by i.priority desc, i.created_at desc)
         from public.schedule_items i where i.screen_id = p_screen and i.enabled), '[]'::jsonb),
    'playlists', coalesce((
       select jsonb_object_agg(p.id, jsonb_build_object('name', p.name, 'slides', p.slides, 'settings', p.settings))
         from public.playlists p where p.id = any(ids) and p.client_id = s.client_id), '{}'::jsonb)
  );
end;
$$;
revoke all on function public._build_screen_content(uuid) from public, anon, authenticated;

create or replace function public._screens_using_playlist(p_client uuid, p_playlist uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from public.screens
   where client_id = p_client and public.license_ok(license_type, license_expires_at)
     and (default_playlist_id = p_playlist
          or p_playlist = any(also_playlist_ids)
          or id in (select screen_id from public.schedule_items where playlist_id = p_playlist)
          or default_playlist_id in (select id from public.playlists where client_id = p_client and (settings ->> 'side_playlist_id' = p_playlist::text or coalesce(settings -> 'zones', '[]'::jsonb) ? p_playlist::text))
          or id in (select si.screen_id from public.schedule_items si join public.playlists pp on pp.id = si.playlist_id
                     where pp.settings ->> 'side_playlist_id' = p_playlist::text or coalesce(pp.settings -> 'zones', '[]'::jsonb) ? p_playlist::text));
$$;

-- Emails: wordmark without the space, same weight for both words.
create or replace function public._email_html(p_title text, p_body text)
returns text language sql immutable as $$
  select '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;padding:24px">'
      || '<div style="font-weight:500;letter-spacing:.06em;margin-bottom:18px">PROVIEW<span style="color:#4a6cd0">SIGNAGE</span></div>'
      || '<h2 style="margin:0 0 10px;font-size:20px">' || public._esc(p_title) || '</h2>'
      || '<p style="color:#444;line-height:1.5;margin:0">' || public._esc(p_body) || '</p>'
      || '<p style="color:#999;font-size:12px;margin-top:28px">Automatic alert from PROVIEW SIGNAGE · www.proviewsignage.co.uk · 020 8935 5495</p></div>';
$$;

create or replace function public.send_invite_email(p_invite uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  i public.invites;
  cname text;
  inviter text := coalesce(auth.jwt() ->> 'email', 'PROVIEW SIGNAGE');
  link text;
  html text;
begin
  select * into i from public.invites where id = p_invite;
  if not found then raise exception 'Invite not found.'; end if;
  if not (public.is_admin() or public.is_member(i.client_id, array['manager'])) then raise exception 'Only managers can send invites.'; end if;
  if i.accepted_at is not null then raise exception 'This invite has already been accepted.'; end if;
  if public._secret('resend_api_key') is null then
    raise exception 'Email sending isn''t set up yet. An admin needs to add the Resend API key in Clients & TVs → Alerts & email. Meanwhile, copy the link and send it yourself.';
  end if;
  select coalesce(nullif(site_name, ''), name) into cname from public.clients where id = i.client_id;
  link := rtrim((select app_url from public.app_settings where id = 1), '/') || '/#/join/' || i.token;
  html := '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;padding:28px 24px;color:#17171c">'
    || '<div style="font-weight:500;letter-spacing:.06em;margin-bottom:22px">PROVIEW<span style="color:#4a6cd0">SIGNAGE</span></div>'
    || '<h2 style="margin:0 0 12px;font-size:22px">You''re invited to manage ' || public._esc(cname) || '’s screens</h2>'
    || '<p style="color:#444;line-height:1.55;margin:0 0 22px">' || public._esc(inviter) || ' has given you <b>'
    || case when i.role = 'manager' then 'manager' else 'editor' end
    || '</b> access to the digital signage for <b>' || public._esc(cname) || '</b>. '
    || 'Create your account with this email address (' || public._esc(i.email) || ') to get started.</p>'
    || '<a href="' || public._esc(link) || '" style="display:inline-block;background:#3d73d3;background-image:linear-gradient(135deg,#2f84d4,#5a5fbb);color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px">Accept invite</a>'
    || '<p style="color:#888;font-size:13px;line-height:1.5;margin:22px 0 0">Or open this link: <br><a href="' || public._esc(link) || '" style="color:#3d73d3;word-break:break-all">' || public._esc(link) || '</a></p>'
    || '<p style="color:#999;font-size:12px;margin-top:30px;border-top:1px solid #eee;padding-top:14px">PROVIEW SIGNAGE · www.proviewsignage.co.uk · Support 020 8935 5495</p></div>';
  if not public._send_email(array[i.email], 'You''re invited to ' || cname || ' on PROVIEW SIGNAGE', html) then
    raise exception 'The email could not be sent. Copy the link and send it yourself.';
  end if;
  update public.invites set emailed_at = now() where id = i.id;
  return true;
end;
$$;
revoke all on function public.send_invite_email(uuid) from public, anon;
grant execute on function public.send_invite_email(uuid) to authenticated;


-- ===== 014_video_walls.sql =====
-- Video walls: several TVs showing one picture together.
-- screens.wall = { id, name, cols, rows, x, y, bezel } — this TV's place in the wall (x/y 0-based).
alter table public.screens add column if not exists wall jsonb;

-- Server time in milliseconds, so the TVs in a wall can agree on "now".
create or replace function public.server_now()
returns double precision language sql volatile as $$
  select floor(extract(epoch from clock_timestamp()) * 1000)::double precision
$$;
grant execute on function public.server_now() to anon, authenticated;


-- ===== 015_screen_rotation.sql =====
-- Per-TV screen rotation (degrees clockwise) for TVs mounted on their side.
alter table public.screens add column if not exists rotation smallint not null default 0;
do $$ begin
  alter table public.screens add constraint screens_rotation_chk check (rotation in (0, 90, 180, 270));
exception when duplicate_object then null; end $$;


-- ===== 016_app_update.sql =====
-- "Update app" button on the dashboard: the TV checks for a newer app when this changes.
alter table public.screens add column if not exists update_requested_at timestamptz;


-- ===== 017_reload_on_publish.sql =====
-- Every publish also tells the TV to reload, so it always picks up the new content
-- (covers the Publish button, Re-send to TV, quick playlist switch and approvals).
create or replace function public.screens_reload_on_publish()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.published_at is distinct from old.published_at and new.content is not null then
    new.reload_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists screens_reload_on_publish on public.screens;
create trigger screens_reload_on_publish before update on public.screens
  for each row execute function public.screens_reload_on_publish();


-- ===== 018_activity_ignore_reload.sql =====
-- Publishing now also sets reload_at: keep it out of the activity log so publishes still read "published".
create or replace function public.log_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  act text := lower(tg_op) || 'd';
  ent text := tg_argv[0];
  cid uuid;
  nm text;
  det text := null;
  changed text[];
begin
  -- only log people, not TVs or background jobs
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return coalesce(new, old);
  end if;
  if act = 'insertd' then act := 'created'; elsif act = 'updated' then act := 'updated'; else act := 'deleted'; end if;

  cid := case when ent = 'client' then (r ->> 'id')::uuid else nullif(r ->> 'client_id', '')::uuid end;
  nm := coalesce(r ->> 'name', r ->> 'label', r ->> 'email', r ->> 'message');

  if tg_op = 'UPDATE' then
    select array_agg(k) into changed
      from jsonb_object_keys(r) k
     where r -> k is distinct from o -> k
       and k not in ('updated_at', 'last_seen', 'device_info', 'schedule_updated_at', 'hardware_id', 'pairing_code', 'created_at', 'reload_at', 'update_requested_at');
    if changed is null then return new; end if;
    if ent = 'screen' then
      if changed = array['content'] or changed <@ array['content', 'published_at'] then act := 'published'; det := null;
      elsif changed && array['license_type', 'license_expires_at'] then act := 'licence changed';
        det := coalesce(r ->> 'license_type', 'none') || coalesce(' until ' || to_char((r ->> 'license_expires_at')::timestamptz, 'DD Mon YYYY'), '');
      elsif changed <@ array['screenshot_requested_at', 'screenshot_at', 'screenshot_path', 'reload_at'] then return new;
      else det := array_to_string(changed, ', ');
      end if;
    elsif ent = 'playlist' then
      det := case when changed <@ array['slides'] then 'slides edited' else array_to_string(changed, ', ') end;
    else
      det := array_to_string(changed, ', ');
    end if;
    -- collapse rapid autosaves of the same thing by the same person
    if exists (select 1 from public.activity a where a.entity = ent and a.entity_id = r ->> 'id' and a.user_id = auth.uid()
                and a.action = act and a.at > now() - interval '10 minutes') then
      update public.activity set at = now(), details = det, entity_name = nm
       where id = (select id from public.activity a where a.entity = ent and a.entity_id = r ->> 'id' and a.user_id = auth.uid()
                    and a.action = act order by at desc limit 1);
      return new;
    end if;
  end if;

  insert into public.activity (client_id, user_id, email, action, entity, entity_id, entity_name, details)
  values (cid, auth.uid(), auth.jwt() ->> 'email', act, ent, r ->> 'id', nm, det);
  return coalesce(new, old);
exception when others then
  return coalesce(new, old);   -- never block the real change
end;
$$;


-- ===== 019_admin_password_reset.sql =====
-- Admin can reset a user's password to the temporary password 123456.
-- The user must choose a new password when they next sign in; the temporary one stops working after 24 hours.
-- Flags live in auth.users.raw_app_meta_data (part of the user's login token; users cannot change it themselves):
--   must_change_password: true, temp_password_until: <timestamp>

create or replace function public.admin_reset_password(p_user uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare em text;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  perform set_config('signage.admin_reset', '1', true);   -- tells the trigger below not to clear the flag
  update auth.users
     set encrypted_password = extensions.crypt('123456', extensions.gen_salt('bf')),
         raw_app_meta_data = (coalesce(raw_app_meta_data, '{}'::jsonb) - 'temp_password_expired')
           || jsonb_build_object('must_change_password', true, 'temp_password_until', now() + interval '24 hours'),
         updated_at = now()
   where id = p_user and coalesce(is_anonymous, false) = false
  returning email into em;
  if em is null then raise exception 'user not found'; end if;
  delete from auth.sessions where user_id = p_user;          -- signs them out everywhere
  return em;
end;
$$;
revoke all on function public.admin_reset_password(uuid) from public, anon;
grant execute on function public.admin_reset_password(uuid) to authenticated;

-- When the user sets their own new password, clear the flags.
create or replace function public.auth_clear_temp_password()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('signage.admin_reset', true), '') = '1' then return new; end if;
  if new.encrypted_password is distinct from old.encrypted_password
     and coalesce(old.raw_app_meta_data ->> 'must_change_password', '') = 'true' then
    new.raw_app_meta_data := new.raw_app_meta_data - 'must_change_password' - 'temp_password_until' - 'temp_password_expired';
  end if;
  return new;
end;
$$;
drop trigger if exists auth_clear_temp_password on auth.users;
create trigger auth_clear_temp_password before update on auth.users
  for each row execute function public.auth_clear_temp_password();

-- Temporary passwords not used within 24 hours stop working (replaced by a random one).
create or replace function public.expire_temp_passwords()
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform set_config('signage.admin_reset', '1', true);
  update auth.users
     set encrypted_password = extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
         raw_app_meta_data = (raw_app_meta_data - 'temp_password_until') || jsonb_build_object('temp_password_expired', true)
   where raw_app_meta_data ->> 'must_change_password' = 'true'
     and (raw_app_meta_data ->> 'temp_password_until')::timestamptz < now();
end;
$$;
revoke all on function public.expire_temp_passwords() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('signage-expire-temp-passwords') where exists (select 1 from cron.job where jobname = 'signage-expire-temp-passwords');
  perform cron.schedule('signage-expire-temp-passwords', '7 * * * *', 'select public.expire_temp_passwords()');
exception when others then
  raise notice 'Could not schedule job: %', sqlerrm;
end $$;


-- ===== 020_device_unpair.sql =====
-- "Unlink this TV" from the TV app's own menu (anyone with the TV remote can open that menu).
-- A TV can only unlink itself: the row is found by the TV's own sign-in (device_user_id).
-- Clears the same things as "Remove TV" on the dashboard, plus any video-wall position,
-- and gives the TV a fresh pairing code so it shows the pairing screen again.
create or replace function public.device_unpair()
returns public.screens language plpgsql security definer set search_path = public as $$
declare
  s public.screens;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into s from public.screens where device_user_id = auth.uid();
  if not found then raise exception 'screen not found'; end if;
  delete from public.schedule_items where screen_id = s.id;
  update public.screens
     set claimed = false, client_id = null, default_playlist_id = null, also_playlist_ids = '{}', content = null,
         published_at = null, schedule_updated_at = null, name = 'New screen', location = null, wall = null,
         pairing_code = public.gen_pairing_code(), created_at = now()
   where id = s.id
   returning * into s;
  return s;
end;
$$;

revoke all on function public.device_unpair() from public, anon;
grant execute on function public.device_unpair() to authenticated;


-- ===== 021_self_signup_trial.sql =====
-- 021: self sign-up from the website, with a one-screen free trial.
--  • create_my_business(): a signed-up user with no business yet creates one and becomes its manager.
--  • Businesses created this way are marked self_signup. Until one of their TVs has a paid licence,
--    they can pair only 1 TV (the 7-day trial). Businesses added by an admin are not limited.
--  • Admins get a notification for every new sign-up.

alter table public.clients add column if not exists self_signup boolean not null default false;

-- Does this business have at least one TV on a paid (non-trial), current licence?
create or replace function public.client_has_paid_licence(p_client uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.screens
     where client_id = p_client
       and license_type is not null and license_type <> 'trial7'
       and (license_type = 'lifetime' or license_expires_at > now()));
$$;
revoke all on function public.client_has_paid_licence(uuid) from public, anon, authenticated;

create or replace function public.create_my_business(p_name text, p_phone text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  nm text := left(trim(coalesce(p_name, '')), 80);
  em text := auth.jwt() ->> 'email';
begin
  if not public.is_real_user() then raise exception 'Please sign in first.'; end if;
  if length(nm) < 2 then raise exception 'Please enter your business name.'; end if;
  if exists (select 1 from public.client_members where user_id = auth.uid()) then
    raise exception 'Your account already belongs to a business.';
  end if;
  insert into public.clients (name, contact_email, self_signup, notes)
  values (nm, em, true, nullif('Signed up online' || coalesce(' · phone ' || nullif(left(trim(p_phone), 30), ''), ''), ''))
  returning id into cid;
  insert into public.client_members (client_id, user_id, role) values (cid, auth.uid(), 'manager');
  -- tell the admins (client_id null = admins only)
  insert into public.notifications (client_id, kind, title, body)
  values (null, 'signup', 'New sign-up: ' || nm,
          coalesce(em, 'unknown email') || coalesce(' · ' || nullif(left(trim(p_phone), 30), ''), '') || ' started a free trial.');
  return cid;
end;
$$;
revoke all on function public.create_my_business(text, text) from public, anon;
grant execute on function public.create_my_business(text, text) to authenticated;

-- Pairing: same as before (003), plus the one-TV limit for self sign-up businesses still on trial.
create or replace function public.claim_screen(p_code text, p_name text default null, p_client uuid default null)
returns public.screens language plpgsql security definer set search_path = public as $$
declare
  s public.screens;
  give_trial boolean := false;
  reason text := null;
begin
  if not public.is_real_user() then raise exception 'sign in to pair a screen'; end if;
  if p_client is null and not public.is_admin() then raise exception 'choose a client'; end if;
  if p_client is not null and not public.is_member(p_client, array['manager']) then
    raise exception 'only managers can add screens';
  end if;

  if p_client is not null and not public.is_admin()
     and exists (select 1 from public.clients where id = p_client and self_signup)
     and not public.client_has_paid_licence(p_client)
     and (select count(*) from public.screens where client_id = p_client and claimed) >= 1 then
    raise exception 'Your free trial includes 1 screen. Buy a licence for your first TV to add more, or call us on 020 8935 5495.';
  end if;

  select * into s from public.screens
   where pairing_code = upper(replace(trim(p_code), ' ', '')) and not claimed
   for update;
  if not found then
    raise exception 'No screen is showing that code. Check the code on the TV and try again.';
  end if;

  if s.license_type is null then
    if s.hardware_id is null then
      reason := 'no device ID: use the PROVIEW SIGNAGE TV app, or ask Proview for a licence';
    elsif exists (select 1 from public.trial_devices where hardware_id = s.hardware_id) then
      reason := 'this device has already used its free trial';
    else
      give_trial := true;
      insert into public.trial_devices (hardware_id, screen_id) values (s.hardware_id, s.id)
      on conflict (hardware_id) do nothing;
    end if;
  end if;

  update public.screens
     set claimed = true, client_id = p_client, pairing_code = null,
         name = coalesce(nullif(trim(p_name), ''), name),
         license_type       = case when give_trial then 'trial7' else license_type end,
         license_starts_at  = case when give_trial then now() else license_starts_at end,
         license_expires_at = case when give_trial then now() + interval '7 days' else license_expires_at end,
         license_updated_at = case when give_trial then now() else license_updated_at end,
         trial_blocked_reason = case when license_type is null and not give_trial then reason else trial_blocked_reason end
   where id = s.id
  returning * into s;
  return s;
end;
$$;
revoke all on function public.claim_screen(text, text, uuid) from public, anon;
grant execute on function public.claim_screen(text, text, uuid) to authenticated;

-- whoami also says whether the business signed up online (the dashboard shows the trial limit)
create or replace function public.whoami()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id',  auth.uid(),
    'email',    auth.jwt() ->> 'email',
    'is_admin', public.is_admin(),
    'clients',  coalesce((
       select jsonb_agg(jsonb_build_object(
                'id', c.id, 'name', c.name, 'contact_email', c.contact_email, 'require_approval', c.require_approval,
                'self_signup', c.self_signup, 'trial_only', c.self_signup and not public.client_has_paid_licence(c.id),
                'role', case when public.is_admin() then coalesce(m.role, 'admin') else m.role end)
              order by lower(c.name))
         from public.clients c
         left join public.client_members m on m.client_id = c.id and m.user_id = auth.uid()
        where public.is_admin() or m.user_id is not null), '[]'::jsonb)
  );
$$;


-- ===== 022_trial_3_days.sql =====
-- =====================================================================
--  022: free trial is now 3 days (was 7)
--  - New TVs get a 3-day trial when first paired (once per device).
--  - Trials stop when they end: the 7-day grace period is for paid
--    licences only (keep in sync with web/js/license.js).
--  - TVs already on a trial keep the end date they were given.
--  The licence code stays 'trial7' so existing data keeps working.
--  Safe to re-run.
-- =====================================================================

create or replace function public.license_interval(p_type text)
returns interval language sql immutable as $$
  select case p_type
    when 'trial7' then interval '3 days'
    when 'm1'  then interval '1 month'
    when 'm3'  then interval '3 months'
    when 'm6'  then interval '6 months'
    when 'm12' then interval '12 months'
    when 'm24' then interval '24 months'
    when 'm36' then interval '36 months'
  end;
$$;

-- True while the TV may play: licensed and not past expiry (+ grace for paid licences).
create or replace function public.license_ok(p_type text, p_expires timestamptz)
returns boolean language sql stable as $$
  select p_type is not null
     and (p_type = 'lifetime' or p_expires is null
          or p_expires + case when p_type = 'trial7' then interval '0' else public.license_grace() end > now());
$$;

create or replace function public.claim_screen(p_code text, p_name text default null, p_client uuid default null)
returns public.screens language plpgsql security definer set search_path = public as $$
declare
  s public.screens;
  give_trial boolean := false;
  reason text := null;
begin
  if not public.is_real_user() then raise exception 'sign in to pair a screen'; end if;
  if p_client is null and not public.is_admin() then raise exception 'choose a client'; end if;
  if p_client is not null and not public.is_member(p_client, array['manager']) then
    raise exception 'only managers can add screens';
  end if;

  if p_client is not null and not public.is_admin()
     and exists (select 1 from public.clients where id = p_client and self_signup)
     and not public.client_has_paid_licence(p_client)
     and (select count(*) from public.screens where client_id = p_client and claimed) >= 1 then
    raise exception 'Your free trial includes 1 screen. Buy a licence for your first TV to add more, or call us on 020 8935 5495.';
  end if;

  select * into s from public.screens
   where pairing_code = upper(replace(trim(p_code), ' ', '')) and not claimed
   for update;
  if not found then
    raise exception 'No screen is showing that code. Check the code on the TV and try again.';
  end if;

  if s.license_type is null then
    if s.hardware_id is null then
      reason := 'no device ID: use the PROVIEW SIGNAGE TV app, or ask Proview for a licence';
    elsif exists (select 1 from public.trial_devices where hardware_id = s.hardware_id) then
      reason := 'this device has already used its free trial';
    else
      give_trial := true;
      insert into public.trial_devices (hardware_id, screen_id) values (s.hardware_id, s.id)
      on conflict (hardware_id) do nothing;
    end if;
  end if;

  update public.screens
     set claimed = true, client_id = p_client, pairing_code = null,
         name = coalesce(nullif(trim(p_name), ''), name),
         license_type       = case when give_trial then 'trial7' else license_type end,
         license_starts_at  = case when give_trial then now() else license_starts_at end,
         license_expires_at = case when give_trial then now() + interval '3 days' else license_expires_at end,
         license_updated_at = case when give_trial then now() else license_updated_at end,
         trial_blocked_reason = case when license_type is null and not give_trial then reason else trial_blocked_reason end
   where id = s.id
  returning * into s;
  return s;
end;
$$;


revoke all on function public.claim_screen(text, text, uuid) from public, anon;
grant execute on function public.claim_screen(text, text, uuid) to authenticated;

create or replace function public.check_alerts()
returns int language plpgsql security definer set search_path = public as $$
declare
  st public.app_settings;
  r record;
  n int := 0;
  days int;
  stage text;
  place text;
  rcpt text[];
begin
  select * into st from public.app_settings where id = 1;

  for r in
    select s.*, c.name as client_name, si.name as site_name
      from public.screens s
      join public.clients c on c.id = s.client_id
      left join public.sites si on si.id = s.site_id
     where s.claimed
  loop
    place := concat_ws(' · ', r.client_name, r.site_name, r.location);

    -- offline / back online (only for TVs that are licensed)
    if public.license_ok(r.license_type, r.license_expires_at) then
      if r.offline_since is null and r.last_seen < now() - make_interval(mins => st.alert_offline_minutes) then
        insert into public.notifications (client_id, screen_id, kind, title, body)
        values (r.client_id, r.id, 'offline', r.name || ' is offline',
                'Not seen since ' || to_char(r.last_seen at time zone 'Europe/London', 'HH24:MI DD Mon') || '. ' || place || '. Check the TV is on and connected to the internet.');
        update public.screens set offline_since = now() where id = r.id;
        n := n + 1;
      elsif r.offline_since is not null and r.last_seen > r.offline_since then
        insert into public.notifications (client_id, screen_id, kind, title, body)
        values (r.client_id, r.id, 'online', r.name || ' is back online', place || '.');
        update public.screens set offline_since = null where id = r.id;
        n := n + 1;
      end if;
    end if;

    -- licence reminders
    if r.license_type is not null and r.license_type <> 'lifetime' and r.license_expires_at is not null then
      days := ceil(extract(epoch from r.license_expires_at - now()) / 86400)::int;
      stage := case when days <= 0 then 'expired' when days <= 3 then '3d' when days <= 14 then '14d' else null end;
      if stage is null and r.license_notice is not null then
        update public.screens set license_notice = null where id = r.id;
      elsif stage is not null and coalesce(r.license_notice, '') <> stage
            and coalesce(r.license_notice, '') <> 'expired' and not (coalesce(r.license_notice, '') = '3d' and stage = '14d') then
        insert into public.notifications (client_id, screen_id, kind, title, body)
        values (r.client_id, r.id, 'licence_' || stage,
                case stage when 'expired' then 'Licence expired: ' || r.name
                           else 'Licence ends in ' || days || ' day' || case when days = 1 then '' else 's' end || ': ' || r.name end,
                case when r.license_type = 'trial7' then 'Free trial' else 'Licence' end || ' for ' || r.name || ' (' || place || ') '
                  || case stage when 'expired' then 'ended on ' else 'ends on ' end || to_char(r.license_expires_at, 'DD Mon YYYY')
                  || case when stage = 'expired' and r.license_type = 'trial7' then '. The screen has stopped playing: buy a licence to turn it back on.'
                           when stage = 'expired' then '. The screen keeps playing for 7 days, then stops.' else '. Renew to avoid interruption.' end);
        update public.screens set license_notice = stage where id = r.id;
        n := n + 1;
      end if;
    end if;
  end loop;

  -- emails for new notifications
  if st.alerts_email_enabled then
    for r in select nt.*, c.contact_email from public.notifications nt left join public.clients c on c.id = nt.client_id
              where not nt.emailed and nt.created_at > now() - interval '1 day' order by nt.id limit 50
    loop
      rcpt := array(select distinct e from (
                select p.email as e from public.profiles p where p.is_admin and p.email is not null
                union select st.admin_alert_email where st.admin_alert_email is not null
                union select r.contact_email where st.alerts_to_clients and r.contact_email is not null
                union select p.email from public.client_members m join public.profiles p on p.id = m.user_id
                       where st.alerts_to_clients and m.client_id = r.client_id and m.role = 'manager'
              ) x where e is not null and e <> '');
      perform public._send_email(rcpt, r.title, public._email_html(r.title, r.body));
      update public.notifications set emailed = true where id = r.id;
    end loop;
  else
    update public.notifications set emailed = true where not emailed;
  end if;

  perform public.check_payments();
  return n;
end;
$$;
