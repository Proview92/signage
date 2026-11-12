-- 050: Signage licences are per TV only (owner, 12 Nov 2026: "Signage does not require a location licence, its
-- licences work per TV"). Undoes the location half of 045 without dropping its columns:
--  * a TV plays / can be published to when its OWN licence is valid (tv_licence_ok ignores the location's copy);
--  * hub_call 'list' no longer reports location units and 'set' refuses a location licence;
--  * a location licence still set is moved onto each TV of that location that has no valid licence of its own,
--    then cleared, so nothing anyone paid for is lost. Safe to run more than once.

-- 1) move location licences to unlicensed TVs, then clear them
update public.screens sc
   set license_type = si.license_type, license_starts_at = si.license_starts_at, license_expires_at = si.license_expires_at,
       license_notes = coalesce(nullif(trim(si.license_notes), '') || ' · ', '') || 'Moved from the location licence (12 Nov 2026)',
       license_updated_at = now()
  from public.sites si
 where si.id = coalesce(sc.site_id, (select s2.id from public.sites s2 where s2.client_id = sc.client_id order by s2.created_at, s2.id limit 1))
   and si.license_type is not null and public.license_ok(si.license_type, si.license_expires_at)
   and not public.license_ok(sc.license_type, sc.license_expires_at);
update public.sites set license_type = null, license_starts_at = null, license_expires_at = null, license_updated_at = now(),
       license_notes = 'Location licences are no longer used: Signage is licensed per TV (12 Nov 2026)'
 where license_type is not null;

-- 2) a TV plays on its own licence
create or replace function public.tv_licence_ok(p_type text, p_expires timestamptz, p_site_type text, p_site_expires timestamptz)
returns boolean language sql stable set search_path = public as $$
  select public.license_ok(p_type, p_expires);
$$;

create or replace function public.publish_screen(p_screen uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s public.screens;
begin
  select * into s from public.screens where id = p_screen;
  if s.client_id is null or not public.is_member(s.client_id) or not public.can_see_screen(p_screen) then raise exception 'screen not found'; end if;
  if not public.has_feature(s.client_id, 'schedule') then raise exception 'You don''t have access to schedules. Ask your owner or admin.'; end if;
  if public.needs_approval(s.client_id) then raise exception 'APPROVAL_REQUIRED'; end if;
  if not public.license_ok(s.license_type, s.license_expires_at) then
    raise exception 'The licence for "%" has expired. Renew it with Buy licence online, or call Proview on 020 8935 5495.', s.name;
  end if;
  update public.screens set content = public._build_screen_content(p_screen), published_at = now() where id = p_screen;
end;
$$;

-- 3) the master's 3-day trial: the business trial alone (TVs added during it get their trial when paired, claim_screen)
create or replace function public.master_trial(p_client uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.clients; e timestamptz := now() + interval '3 days';
begin
  if not public.is_admin() then raise exception 'Only the Proview master can start a trial.'; end if;
  select * into c from public.clients where id = p_client for update;
  if not found then raise exception 'Business not found.'; end if;
  if c.trial_ends_at is not null
     or exists (select 1 from public.screens s where s.client_id = p_client and s.license_type is not null) then
    return jsonb_build_object('applied', false, 'expires_at', c.trial_ends_at);
  end if;
  update public.clients set trial_ends_at = e where id = p_client;
  return jsonb_build_object('applied', true, 'expires_at', e);
end;
$$;

-- 4) the licence hub: TV units only
create or replace function hub_private.hub_call_pre_trial(p_token text, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  r jsonb;
  kind text := lower(nullif(trim(coalesce(p_args->>'kind', '')), ''));
  unit text := coalesce(p_args->>'unit', '');
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
                  from jsonb_array_elements(coalesce(r->'units', '[]'::jsonb)) u), '[]'::jsonb));

  elsif p_action = 'set' then
    if kind = 'location' or unit like 'loc/%' then
      raise exception 'Signage is licensed per TV: locations don''t need a licence.';
    end if;
    if kind is not null and kind <> 'screen' then raise exception 'Unknown kind %', kind; end if;
    r := hub_private.hub_call_tv(p_token, p_action, p_args - 'kind');
    return r || jsonb_build_object('kind', 'screen');
  end if;

  return hub_private.hub_call_tv(p_token, p_action, p_args);
end;
$$;
