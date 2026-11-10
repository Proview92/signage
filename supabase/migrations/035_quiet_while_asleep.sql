-- =====================================================================
--  035: no "offline" / "back online" alerts while a TV is in its sleep hours
--  A TV that sleeps (01:00–07:00, say) drops off the network and wakes up now and then, so check_alerts sent
--  "is offline" / "is back online" emails all night. Now a TV counts as "quiet" (no offline alert) during its
--  sleep hours or a manual Sleep now, plus 20 minutes after it is due to wake (time to reconnect).
--  Uses the TV's own time zone (device_info.tz), else Europe/London: the same rules as web/js/sleep.js.
--  check_alerts is changed in place (only its offline condition); safe to re-run.
-- =====================================================================

create or replace function public.sleep_window_at(p_sleep jsonb, p_local timestamp) returns boolean
language plpgsql immutable as $$
declare
  f int; t int; m int; d int; y int; days int[];
begin
  if p_sleep is null or coalesce((p_sleep->>'on')::boolean, false) is not true then return false; end if;
  f := split_part(p_sleep->>'from', ':', 1)::int * 60 + split_part(p_sleep->>'from', ':', 2)::int;
  t := split_part(p_sleep->>'to', ':', 1)::int * 60 + split_part(p_sleep->>'to', ':', 2)::int;
  if f = t then return false; end if;
  if jsonb_typeof(p_sleep->'days') = 'array' then
    days := array(select jsonb_array_elements_text(p_sleep->'days')::int);
  else
    days := array[0,1,2,3,4,5,6];
  end if;
  m := extract(hour from p_local)::int * 60 + extract(minute from p_local)::int;
  d := extract(dow from p_local)::int;           -- 0 = Sunday, as in JavaScript getDay()
  y := (d + 6) % 7;
  if f < t then return d = any(days) and m >= f and m < t; end if;
  return (d = any(days) and m >= f) or (y = any(days) and m < t);
exception when others then
  return false;   -- badly formed sleep settings: treat as awake (alerts as normal)
end $$;

create or replace function public.screen_sleep_quiet(p_sleep jsonb, p_override jsonb, p_tz text, p_grace int default 20)
returns boolean language plpgsql stable as $$
declare
  tz text := 'Europe/London';
  loc timestamp;
  u timestamptz;
begin
  if p_tz is not null and exists (select 1 from pg_timezone_names where name = p_tz) then tz := p_tz; end if;
  -- manual Sleep now / Wake now from the dashboard wins while it lasts
  begin u := (p_override->>'until')::timestamptz; exception when others then u := null; end;
  if u is not null and p_override->>'state' in ('sleep', 'wake') and u > now() - make_interval(mins => p_grace) then
    if p_override->>'state' = 'sleep' then return true; end if;
    if u > now() then return false; end if;   -- woken by hand: alerts as normal
  end if;
  loc := now() at time zone tz;
  return public.sleep_window_at(p_sleep, loc) or public.sleep_window_at(p_sleep, loc - make_interval(mins => p_grace));
end $$;

do $m$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.check_alerts()'::regprocedure);
  if position('screen_sleep_quiet' in d) > 0 then raise notice '035: check_alerts already updated'; return; end if;
  d2 := replace(d,
    'if r.offline_since is null and r.last_seen < now() - make_interval(mins => st.alert_offline_minutes) then',
    'if r.offline_since is null and r.last_seen < now() - make_interval(mins => st.alert_offline_minutes)
         and not public.screen_sleep_quiet(r.sleep, r.sleep_override, r.device_info->>''tz'') then');
  if d2 = d then raise exception '035: offline condition not found in check_alerts - nothing changed'; end if;
  execute d2;
  raise notice '035: check_alerts now stays quiet while TVs sleep';
end $m$;

notify pgrst, 'reload schema';
