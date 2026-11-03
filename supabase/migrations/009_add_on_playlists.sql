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
