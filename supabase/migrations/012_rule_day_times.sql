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
