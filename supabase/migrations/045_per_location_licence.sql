-- 045: a licence per location, plus the TV licence (PER_LOCATION_LICENCE_SPEC, owner 11 Nov 2026:
-- "A licence does not cover the whole business; additional locations require an additional licence" and, for Signage,
-- "Per location + per TV").
--
-- Storage: columns on public.sites (license_type, license_starts_at, license_expires_at, license_notes,
-- license_updated_at), the same names and types as the TV licence on public.screens. A location is a sites row, one
-- licence per location, so a separate table would only add a join; the columns get the sites RLS (members of the
-- business read them) for free, and the shared licence code (license.js licenseState) reads a site exactly like a TV.
-- Only trusted server code (hub_call 'set' from the licence portal / Stripe) can change them: sites_licence_guard.
--
-- The TV player reads only its own screens row (and gets it live and keeps it for offline starts), so each TV carries
-- a read-only copy of its location's licence: screens.site_license_type / site_license_expires_at, kept in step by
-- triggers (screens_site_licence on the TV, sites_licence_sync on the location). A TV with no location uses the first
-- location of its business (Signage has one location per business).
--
-- A TV plays only if its own licence AND its location's licence are valid (license_ok, same 7-day grace).
-- The server refuses to publish to it otherwise (publish_screen, _screens_using_playlist, decide_approval) and only
-- licensed TVs get offline alerts (check_alerts).
--
-- Existing locations: lifetime, so nobody is locked out. New locations (a new business, self-signup, add_business,
-- hub_call add_business, direct inserts): no licence (NO_TRIAL_SPEC).
--
-- The master's 3-day trial from Add business (044 master_trial): now also gives the business's location(s) a 'trial7'
-- licence ending with the business trial, so its TVs can play during it.
--
-- hub_call: 'list' also returns location units (kind 'location', id 'loc/<site id>'); TV units get kind 'screen'.
-- 'set' takes kind 'location' or a 'loc/' unit; a missing kind is a TV as before. hub_plans takes per-kind prices.
-- See /home/claude/HUB_UNITS.md. Safe to run more than once.

-- 1) The location licence, and 2) existing locations: lifetime, so nobody is locked out tonight.
--    Done once, when the columns are first added, so running this file again never licenses a newer location.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'sites' and column_name = 'license_type') then
    alter table public.sites add column license_type       text;
    alter table public.sites add column license_starts_at  timestamptz;
    alter table public.sites add column license_expires_at timestamptz;   -- null = lifetime
    alter table public.sites add column license_notes      text;
    alter table public.sites add column license_updated_at timestamptz;
    update public.sites
       set license_type = 'lifetime', license_starts_at = coalesce(created_at, now()), license_expires_at = null,
           license_notes = 'Existing location: lifetime (per-location licences, 11 Nov 2026)', license_updated_at = now();
  end if;
end $$;
do $$ begin
  alter table public.sites add constraint sites_license_type_chk
    check (license_type is null or license_type in ('trial7','m1','m3','m6','m12','m24','m36','lifetime','custom'));
exception when duplicate_object then null; end $$;

-- each TV's read-only copy of its location's licence
alter table public.screens add column if not exists site_license_type       text;
alter table public.screens add column if not exists site_license_expires_at timestamptz;
comment on column public.screens.site_license_type is
  'Copy of the licence of this TV''s location (sites.license_type), kept by triggers. The TV plays only if both are valid.';

-- 3) Only trusted server code sets a location's licence. A location added by anyone else starts with none.
create or replace function public.sites_licence_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then return new; end if;
  if tg_op = 'INSERT' then
    new.license_type := null; new.license_starts_at := null; new.license_expires_at := null;
    new.license_notes := null; new.license_updated_at := null;
  elsif new.license_type is distinct from old.license_type
     or new.license_starts_at is distinct from old.license_starts_at
     or new.license_expires_at is distinct from old.license_expires_at
     or new.license_notes is distinct from old.license_notes
     or new.license_updated_at is distinct from old.license_updated_at then
    raise exception 'Licences are now managed at license.proviewcrm.co.uk';
  end if;
  return new;
end $$;
drop trigger if exists sites_licence_guard on public.sites;
create trigger sites_licence_guard before insert or update on public.sites
  for each row execute function public.sites_licence_guard();

-- 4) The TV's copy: from its location, else its business's first location. Runs after screens_site_guard and
--    screens_default_location (trigger names sort after them), so it sees the final site_id / client_id.
create or replace function public.screens_site_licence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare si public.sites;
begin
  if new.site_id is not null then
    select * into si from public.sites where id = new.site_id;
  elsif new.client_id is not null then
    select * into si from public.sites where client_id = new.client_id order by created_at, id limit 1;
  end if;
  new.site_license_type := si.license_type;
  new.site_license_expires_at := si.license_expires_at;
  return new;
end $$;
drop trigger if exists screens_site_licence on public.screens;
create trigger screens_site_licence
  before insert or update of site_id, client_id, site_license_type, site_license_expires_at on public.screens
  for each row execute function public.screens_site_licence();

create or replace function public.sites_licence_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- touching the copy makes screens_site_licence read the location again
  update public.screens sc set site_license_type = new.license_type
   where sc.site_id = new.id
      or (sc.site_id is null and sc.client_id = new.client_id
          and new.id = (select s.id from public.sites s where s.client_id = new.client_id order by s.created_at, s.id limit 1));
  return null;
end $$;
drop trigger if exists sites_licence_sync on public.sites;
create trigger sites_licence_sync after update of license_type, license_expires_at on public.sites
  for each row execute function public.sites_licence_sync();
revoke execute on function public.sites_licence_guard(), public.screens_site_licence(), public.sites_licence_sync()
  from public, anon, authenticated;

-- fill every TV's copy now
update public.screens set site_license_type = site_license_type;

-- 5) Both licences.
create or replace function public.tv_licence_ok(p_type text, p_expires timestamptz, p_site_type text, p_site_expires timestamptz)
returns boolean
language sql
stable
set search_path = public
as $$
  select public.license_ok(p_type, p_expires) and public.license_ok(p_site_type, p_site_expires);
$$;

create or replace function public.publish_screen(p_screen uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.screens;
begin
  select * into s from public.screens where id = p_screen;
  if s.client_id is null or not public.is_member(s.client_id) or not public.can_see_screen(p_screen) then raise exception 'screen not found'; end if;
  if not public.has_feature(s.client_id, 'schedule') then raise exception 'You don''t have access to schedules. Ask your owner or admin.'; end if;
  if public.needs_approval(s.client_id) then raise exception 'APPROVAL_REQUIRED'; end if;
  if not public.license_ok(s.license_type, s.license_expires_at) then
    raise exception 'The licence for "%" has expired. Contact Proview to renew it.', s.name;
  end if;
  if not public.license_ok(s.site_license_type, s.site_license_expires_at) then
    raise exception 'The location of "%" needs a licence before its TVs can play. Buy the location''s licence online, or call Proview on 020 8935 5495.', s.name;
  end if;
  update public.screens set content = public._build_screen_content(p_screen), published_at = now() where id = p_screen;
end;
$$;

create or replace function public._screens_using_playlist(p_client uuid, p_playlist uuid)
returns setof uuid
language sql
stable security definer
set search_path = public
as $$
  select id from public.screens
   where client_id = p_client and public.tv_licence_ok(license_type, license_expires_at, site_license_type, site_license_expires_at)
     and (default_playlist_id = p_playlist
          or p_playlist = any(also_playlist_ids)
          or id in (select screen_id from public.schedule_items where playlist_id = p_playlist)
          or default_playlist_id in (select id from public.playlists where client_id = p_client and (settings ->> 'side_playlist_id' = p_playlist::text or coalesce(settings -> 'zones', '[]'::jsonb) ? p_playlist::text))
          or id in (select si.screen_id from public.schedule_items si join public.playlists pp on pp.id = si.playlist_id
                     where pp.settings ->> 'side_playlist_id' = p_playlist::text or coalesce(pp.settings -> 'zones', '[]'::jsonb) ? p_playlist::text));
$$;

create or replace function public.decide_approval(p_request uuid, p_approve boolean, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
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
      if found and public.tv_licence_ok(s.license_type, s.license_expires_at, s.site_license_type, s.site_license_expires_at) then
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

-- check_alerts: unchanged except that offline alerts need both licences (a TV that can't play isn't "offline")
create or replace function public.check_alerts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
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

    -- offline / back online (only for TVs that are licensed, TV and location)
    if public.tv_licence_ok(r.license_type, r.license_expires_at, r.site_license_type, r.site_license_expires_at) then
      if r.offline_since is null and r.last_seen < now() - make_interval(mins => st.alert_offline_minutes)
         and not public.screen_sleep_quiet(r.sleep, r.sleep_override, r.device_info->>'tz') then
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

-- 5b) The master's 3-day trial (044): the location gets the same trial, so TVs paired during it can play.
create or replace function public.master_trial(p_client uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare c public.clients; e timestamptz := now() + interval '3 days';
begin
  if not public.is_admin() then raise exception 'Only the Proview master can start a trial.'; end if;
  select * into c from public.clients where id = p_client for update;
  if not found then raise exception 'Business not found.'; end if;
  if c.trial_ends_at is not null
     or exists (select 1 from public.screens s where s.client_id = p_client and s.license_type is not null)
     or exists (select 1 from public.sites s where s.client_id = p_client and s.license_type is not null) then
    return jsonb_build_object('applied', false, 'expires_at', c.trial_ends_at);
  end if;
  update public.clients set trial_ends_at = e where id = p_client;
  update public.sites
     set license_type = 'trial7', license_starts_at = now(), license_expires_at = e,
         license_notes = '3-day trial from Add business', license_updated_at = now()
   where client_id = p_client and license_type is null;
  return jsonb_build_object('applied', true, 'expires_at', e);
end;
$$;
revoke all on function public.master_trial(uuid) from public, anon;
grant execute on function public.master_trial(uuid) to authenticated;

-- 6) Prices per kind. hub_plans stores { "screen": {plan: {...}}, "location": {plan: {...}} }. The portal may send that,
--    or the old flat { plan: {...} }, which is the TV prices only.
create or replace function hub_private.plans_by_kind(p jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when p is null or jsonb_typeof(p) <> 'object' then '{}'::jsonb
    when p ? 'location' or p ? 'screen' then
      jsonb_build_object('screen', coalesce(case when jsonb_typeof(p->'screen') = 'object' then p->'screen' end, '{}'::jsonb),
                         'location', coalesce(case when jsonb_typeof(p->'location') = 'object' then p->'location' end, '{}'::jsonb))
    else jsonb_build_object('screen', p, 'location', '{}'::jsonb)
  end
$$;

create or replace function public.hub_plans(p_token text, p_plans jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare k jsonb := hub_private.plans_by_kind(coalesce(p_plans, '{}'::jsonb));
begin
  if p_token is null or encode(extensions.digest(p_token, 'sha256'), 'hex') is distinct from (select token_sha256 from hub_private.config where id = 1) then
    raise exception 'not authorised';
  end if;
  update hub_private.config set plans = k where id = 1;
  return jsonb_build_object('ok', true,
    'plans', (select count(*) from jsonb_object_keys(k->'screen')) + (select count(*) from jsonb_object_keys(k->'location')),
    'screen', (select count(*) from jsonb_object_keys(k->'screen')),
    'location', (select count(*) from jsonb_object_keys(k->'location')));
end $$;
revoke all on function public.hub_plans(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.hub_plans(text, jsonb) to anon, authenticated, service_role;

-- prices saved before this migration were the TV prices
update hub_private.config set plans = hub_private.plans_by_kind(plans) where id = 1;

-- TV prices (as before, for TV apps and pages still open on the old code)
create or replace function public.licence_buy_plans()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select case when auth.uid() is null then '{}'::jsonb
         else coalesce(hub_private.plans_by_kind((select plans from hub_private.config where id = 1)) -> 'screen', '{}'::jsonb) end
$$;
-- every kind: { "screen": {...}, "location": {...} }
create or replace function public.licence_buy_plans_by_kind()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select case when auth.uid() is null then jsonb_build_object('screen', '{}'::jsonb, 'location', '{}'::jsonb)
         else hub_private.plans_by_kind((select plans from hub_private.config where id = 1)) end
$$;
revoke all on function public.licence_buy_plans(), public.licence_buy_plans_by_kind() from public, anon;
grant execute on function public.licence_buy_plans(), public.licence_buy_plans_by_kind() to authenticated, service_role;

-- 7) hub_call: location units in 'list', location licences in 'set'. Everything else goes to the hub_call that was live
--    before this migration (043's: 'add_business', then 'list' / 'set' for TVs), moved aside unchanged as
--    hub_private.hub_call_tv. Run again after any later change to public.hub_call and that newer one becomes the base.
do $$
declare src text := (select prosrc from pg_proc where oid = to_regprocedure('public.hub_call(text,text,jsonb)'));
begin
  if src is null then raise exception 'public.hub_call(text,text,jsonb) is missing.'; end if;
  if position('hub_private.hub_call_tv' in src) = 0 then
    drop function if exists hub_private.hub_call_tv(text, text, jsonb);
    alter function public.hub_call(text, text, jsonb) rename to hub_call_tv;
    alter function public.hub_call_tv(text, text, jsonb) set schema hub_private;
  end if;
end $$;
revoke all on function hub_private.hub_call_tv(text, text, jsonb) from public, anon, authenticated;

create or replace function public.hub_call(p_token text, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  r jsonb; si public.sites; base timestamptz; new_exp timestamptz;
  kind text := lower(nullif(trim(coalesce(p_args->>'kind', '')), ''));
  unit text := coalesce(p_args->>'unit', '');
  t text := nullif(p_args->>'type', '');
  ext boolean := coalesce((p_args->>'extend')::boolean, false);
  cust timestamptz := nullif(p_args->>'expires', '')::timestamptz;
  nt text := p_args->>'notes';
  sid uuid;
begin
  if p_token is null or encode(extensions.digest(p_token, 'sha256'), 'hex') is distinct from (select token_sha256 from hub_private.config where id = 1) then
    raise exception 'not authorised';
  end if;

  if p_action = 'list' then
    r := hub_private.hub_call_tv(p_token, p_action, p_args);
    return jsonb_set(r, '{units}',
      coalesce((select jsonb_agg(u || jsonb_build_object('kind', 'screen',
                        'location_id', (select coalesce(sc.site_id, (select s2.id from public.sites s2 where s2.client_id = sc.client_id order by s2.created_at, s2.id limit 1))
                                          from public.screens sc where sc.id = (u->>'id')::uuid)))
                  from jsonb_array_elements(coalesce(r->'units', '[]'::jsonb)) u), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object('id', 'loc/' || s.id, 'kind', 'location', 'location_id', s.id,
                        'account_id', s.client_id, 'name', s.name,
                        'detail', 'Location · ' || (select count(*) from public.screens sc where sc.claimed and sc.site_id = s.id) || ' TV(s)',
                        'license_type', s.license_type, 'starts_at', s.license_starts_at, 'expires_at', s.license_expires_at,
                        'notes', s.license_notes, 'last_seen', null) order by s.name)
                  from public.sites s where s.client_id is not null), '[]'::jsonb));

  elsif p_action = 'set' and (kind = 'location' or unit like 'loc/%') then
    begin
      sid := (case when unit like 'loc/%' then substr(unit, 5) else unit end)::uuid;
    exception when others then raise exception 'Location not found'; end;
    select * into si from public.sites where id = sid for update;
    if not found then raise exception 'Location not found'; end if;
    if t is null then
      update public.sites set license_type = null, license_starts_at = null, license_expires_at = null,
             license_updated_at = now(), license_notes = coalesce(nullif(trim(nt), ''), license_notes)
       where id = si.id returning * into si;
    else
      if t = 'lifetime' then new_exp := null;
      elsif t = 'custom' then
        if cust is null then raise exception 'Choose an expiry date.'; end if;
        new_exp := cust;
      elsif public.license_interval(t) is not null then
        base := case when ext and coalesce(si.license_type, '') <> 'lifetime' and si.license_expires_at is not null and si.license_expires_at > now()
                     then si.license_expires_at else now() end;
        new_exp := base + public.license_interval(t);
      else raise exception 'Unknown licence type %', t;
      end if;
      update public.sites
         set license_type = t,
             license_starts_at = case when ext and si.license_starts_at is not null then si.license_starts_at else now() end,
             license_expires_at = new_exp,
             license_notes = coalesce(nullif(trim(nt), ''), license_notes),
             license_updated_at = now()
       where id = si.id returning * into si;
    end if;
    return jsonb_build_object('id', 'loc/' || si.id, 'kind', 'location', 'license_type', si.license_type,
                              'starts_at', si.license_starts_at, 'expires_at', si.license_expires_at, 'notes', si.license_notes);

  elsif p_action = 'set' then
    if kind is not null and kind <> 'screen' then raise exception 'Unknown kind %', kind; end if;
    r := hub_private.hub_call_tv(p_token, p_action, p_args - 'kind');
    return r || jsonb_build_object('kind', 'screen');
  end if;

  return hub_private.hub_call_tv(p_token, p_action, p_args);
end;
$$;
revoke all on function public.hub_call(text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.hub_call(text, text, jsonb) to anon, authenticated, service_role;
