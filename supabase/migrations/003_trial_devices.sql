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
