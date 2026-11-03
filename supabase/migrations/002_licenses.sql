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
update public.screens
   set license_type = 'trial7', license_starts_at = now(),
       license_expires_at = now() + interval '7 days', license_updated_at = now()
 where claimed and license_type is null;

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
