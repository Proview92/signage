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
