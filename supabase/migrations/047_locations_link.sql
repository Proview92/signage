-- 047: Locations, not customers. Only the master links them (LOCATIONS_LINK_SPEC.md, owner 12 Nov 2026).
--
-- The licence portal's licence-hub is the only caller of two new hub actions (LOCATIONS_LINK_PROTOCOL.md):
--   hub_call(token, 'link',   { into: <client A>, from: <client B> })  -> { ok, account: A, from: B, moved_sites, already, renamed_units: [] }
--       merges business B into A in one transaction: B's locations (sites) with their TVs, schedules, playlists, media,
--       messages, stats, licences and members move to A, then B's empty business row is deleted. Idempotent (logged).
--   hub_call(token, 'unlink', { account: <client A>, site: 'loc/<site uuid>' | '<site uuid>' })
--       -> { ok, account: <new client>, from: A, site: 'loc/<site uuid>', already, renamed_units: [] }
--       moves one location out of A into a new business named after it; members who can see it are copied.
--       Refused when A has only that one location.
-- Every other action is exactly the live hub_call, moved to hub_private.hub_call_pre_link.
--
-- Members on link: the higher role wins (manager > site_manager > editor). Managers see every location anyway;
-- site managers get every location of the merged business (owner: "owners and managers of either location get
-- both"); editors keep exactly the locations they had (an editor with "all locations" in B gets B's locations).
-- Content on link: playlists / media shared with "every location" in A or B are tagged with that side's own
-- locations, so nothing of B's appears at A's TVs (and the other way) until an owner shares it; this also makes a later
-- unlink move exactly that location's content. B's business-wide messages (overrides scope 'client') become messages
-- for each of B's locations.
-- Media files stay where they are in storage (folder = the client id they were uploaded under). A folder can now
-- belong to more than one business (media_folder_clients), and the storage checks use it; per-file visibility is
-- still decided by the media row's own business and locations (media_file_visible / media_file_editable).
--
-- Adding and deleting a location: nobody (master included) adds or deletes a single location from the app any more.
-- A business still gets its one location automatically when it is created (self sign-up, master Add business, hub
-- add_business); a whole business can still be deleted by the master (its locations go with it).
-- Safe to run more than once. Apply after 046 (and after any other migration that replaces public.hub_call).

-- 0) a folder of the media bucket may belong to several businesses after a link / unlink
create table if not exists public.media_folder_clients (
  folder    text not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (folder, client_id)
);
alter table public.media_folder_clients enable row level security;   -- no policies: read only by the functions below
revoke all on public.media_folder_clients from anon, authenticated;

create table if not exists hub_private.location_moves (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  action     text not null check (action in ('link', 'unlink')),
  from_account uuid not null,
  into_account uuid not null,
  site       uuid,
  sites      uuid[] not null default '{}',
  details    jsonb not null default '{}'::jsonb
);
create index if not exists location_moves_from on hub_private.location_moves (from_account);

create or replace function public.folder_has_client(p_folder text, p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_client is not null and (p_folder = p_client::text
      or exists (select 1 from public.media_folder_clients f where f.folder = p_folder and f.client_id = p_client)) $$;
revoke all on function public.folder_has_client(text, uuid) from public, anon;
grant execute on function public.folder_has_client(text, uuid) to authenticated;

create or replace function public.is_member_folder(p_folder text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (public.is_real_user() and exists (
            select 1 from public.client_members m
             where m.user_id = auth.uid() and public.folder_has_client(p_folder, m.client_id))) $$;

create or replace function public.has_feature_folder(p_folder text, p_feature text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.clients c
     where (c.id::text = p_folder or c.id in (select f.client_id from public.media_folder_clients f where f.folder = p_folder))
       and public.has_feature(c.id, p_feature)) $$;

-- a TV reads the media of its own business, including folders that came with a linked location
drop policy if exists media_device_read on storage.objects;
create policy media_device_read on storage.objects for select using (
  bucket_id = 'media' and exists (
    select 1 from public.screens s
     where s.device_user_id = auth.uid() and public.license_ok(s.license_type, s.license_expires_at)
       and public.folder_has_client((storage.foldername(objects.name))[1], s.client_id)));

-- 1) a TV that moves business together with its location keeps that location (only while the hub moves it)
create or replace function public.screens_site_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.client_id is distinct from old.client_id
     and coalesce(current_setting('pv.moving_locations', true), '') <> '1' then
    if new.site_id is not null and new.site_id is not distinct from old.site_id then
      new.site_id := null;
    end if;
  end if;
  if new.site_id is not null and not exists (
       select 1 from public.sites s where s.id = new.site_id and s.client_id = new.client_id) then
    raise exception 'That location belongs to a different business.';
  end if;
  return new;
end $$;

-- 2) no adding or deleting single locations from the app (the business's own location is made by its trigger,
--    which runs as the table owner; deleting a business deletes its locations through the foreign key)
drop policy if exists sites_insert on public.sites;
drop policy if exists sites_delete on public.sites;
revoke insert, delete on public.sites from anon, authenticated;

-- 3) link / unlink
create or replace function hub_private.link_clients(p_into uuid, p_from uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  a public.clients; b public.clients; lg hub_private.location_moves;
  a_sites uuid[]; b_sites uuid[]; all_sites uuid[]; m record; ex public.client_members;
  rank_of constant jsonb := '{"manager":3,"site_manager":2,"editor":1}';
begin
  if p_into = p_from then raise exception 'An account can''t be linked to itself.'; end if;
  select * into a from public.clients where id = p_into for update;
  if not found then raise exception 'Account not found: %', p_into; end if;
  select * into b from public.clients where id = p_from for update;
  if not found then
    select * into lg from hub_private.location_moves where action = 'link' and from_account = p_from order by id desc limit 1;
    if lg.id is null then raise exception 'Account not found: %', p_from; end if;
    if lg.into_account <> p_into then
      -- B went into another business that was itself later linked into A: still done
      if not exists (select 1 from hub_private.location_moves l2 where l2.action = 'link'
                      and l2.from_account = lg.into_account and l2.into_account = p_into) then
        raise exception '% was already linked into %, not %.', p_from, lg.into_account, p_into;
      end if;
    end if;
    return jsonb_build_object('ok', true, 'account', p_into::text, 'from', p_from::text, 'already', true,
      'moved_sites', coalesce((select jsonb_agg('loc/' || x) from unnest(lg.sites) x), '[]'::jsonb), 'renamed_units', '[]'::jsonb);
  end if;

  select coalesce(array_agg(id order by created_at, id), '{}') into a_sites from public.sites where client_id = a.id;
  select coalesce(array_agg(id order by created_at, id), '{}') into b_sites from public.sites where client_id = b.id;
  all_sites := a_sites || b_sites;
  perform set_config('pv.moving_locations', '1', true);

  -- content shared with "every location" stays with its own side's locations
  update public.playlists set site_ids = a_sites where client_id = a.id and (site_ids is null or cardinality(site_ids) = 0) and cardinality(a_sites) > 0;
  update public.media     set site_ids = a_sites where client_id = a.id and (site_ids is null or cardinality(site_ids) = 0) and cardinality(a_sites) > 0;
  update public.playlists set site_ids = b_sites where client_id = b.id and (site_ids is null or cardinality(site_ids) = 0) and cardinality(b_sites) > 0;
  update public.media     set site_ids = b_sites where client_id = b.id and (site_ids is null or cardinality(site_ids) = 0) and cardinality(b_sites) > 0;
  -- A's editors with every location keep just A's locations (they don't gain B's)
  update public.client_members set site_ids = a_sites where client_id = a.id and role = 'editor' and site_ids is null;
  update public.client_members_off set site_ids = a_sites where client_id = a.id and role = 'editor' and site_ids is null;

  -- locations first (the guards check that locations belong to the row's business)
  update public.sites set client_id = a.id where client_id = b.id;
  -- media files: B's folders now belong to A as well
  insert into public.media_folder_clients (folder, client_id) values (b.id::text, a.id) on conflict do nothing;
  insert into public.media_folder_clients (folder, client_id)
    select f.folder, a.id from public.media_folder_clients f where f.client_id = b.id on conflict do nothing;
  insert into public.media_folder_clients (folder, client_id)
    select distinct split_part(md.path, '/', 1), a.id from public.media md
     where md.client_id = b.id and split_part(md.path, '/', 1) <> a.id::text on conflict do nothing;

  update public.playlists set client_id = a.id where client_id = b.id;
  update public.media set client_id = a.id where client_id = b.id;
  update public.playlist_pauses set client_id = a.id where client_id = b.id;
  update public.screens set client_id = a.id where client_id = b.id;
  update public.schedule_items set client_id = a.id where client_id = b.id;
  -- B's business-wide messages: one per B location
  insert into public.overrides (scope, client_id, site_id, message, subtitle, style, starts_at, ends_at, active, created_by, created_at)
    select 'site', a.id, s, o.message, o.subtitle, o.style, o.starts_at, o.ends_at, o.active, o.created_by, o.created_at
      from public.overrides o cross join unnest(b_sites) s where o.client_id = b.id and o.scope = 'client';
  delete from public.overrides where client_id = b.id and scope = 'client';
  update public.overrides set client_id = a.id where client_id = b.id;
  update public.activity set client_id = a.id where client_id = b.id;
  update public.approval_requests set client_id = a.id where client_id = b.id;
  update public.play_stats set client_id = a.id where client_id = b.id;
  update public.notifications set client_id = a.id where client_id = b.id;
  update public.payments set client_id = a.id where client_id = b.id;
  update public.team_messages set client_id = a.id where client_id = b.id;
  update public.trial_signups set client_id = a.id where client_id = b.id;
  update public.invites set client_id = a.id,
         site_ids = case when role = 'site_manager' then all_sites when role = 'editor' and site_ids is null then b_sites else site_ids end
   where client_id = b.id;

  -- members: everyone in B joins A; someone in both keeps the higher role
  for m in select * from public.client_members where client_id = b.id loop
    select * into ex from public.client_members where client_id = a.id and user_id = m.user_id;
    if ex.user_id is null then
      insert into public.client_members (client_id, user_id, role, created_at, site_ids, features)
      values (a.id, m.user_id, m.role, m.created_at,
              case when m.role = 'site_manager' then all_sites when m.site_ids is null then b_sites else m.site_ids end, m.features);
    elsif coalesce((rank_of->>m.role)::int, 0) > coalesce((rank_of->>ex.role)::int, 0) then
      update public.client_members set role = m.role, features = m.features,
             site_ids = case when m.role = 'site_manager' then all_sites
                             else array(select distinct x from unnest(coalesce(ex.site_ids, a_sites) || coalesce(m.site_ids, b_sites)) x) end
       where client_id = a.id and user_id = m.user_id;
    else
      update public.client_members
         set site_ids = case when ex.role = 'site_manager' then all_sites
                             when ex.role = 'manager' then null
                             else array(select distinct x from unnest(coalesce(ex.site_ids, a_sites) || coalesce(m.site_ids, b_sites)) x) end
       where client_id = a.id and user_id = m.user_id;
    end if;
  end loop;
  -- A's site managers get B's locations too
  update public.client_members set site_ids = all_sites where client_id = a.id and role = 'site_manager';
  insert into public.client_members_off (client_id, user_id, role, site_ids, features, created_at, deactivated_at, deactivated_by, cascade_from)
    select a.id, o.user_id, o.role, case when o.site_ids is null and o.role <> 'manager' then b_sites else o.site_ids end,
           o.features, o.created_at, o.deactivated_at, o.deactivated_by, o.cascade_from
      from public.client_members_off o
     where o.client_id = b.id and not exists (select 1 from public.client_members x where x.client_id = a.id and x.user_id = o.user_id)
    on conflict (client_id, user_id) do nothing;

  insert into hub_private.location_moves (action, from_account, into_account, sites, details)
  values ('link', b.id, a.id, b_sites, jsonb_build_object('from_name', b.name, 'into_name', a.name,
          'from_trial_ends_at', b.trial_ends_at, 'from_contact_email', b.contact_email));
  -- earlier merges into B now count as merges into A (so a retry of those is still "already")
  update hub_private.location_moves set details = details || jsonb_build_object('then_into', a.id)
   where action = 'link' and into_account = b.id;

  delete from public.clients where id = b.id;   -- empty now (members / invites left over are B's duplicates)
  perform set_config('pv.moving_locations', '', true);
  return jsonb_build_object('ok', true, 'account', a.id::text, 'from', b.id::text, 'already', false,
    'moved_sites', coalesce((select jsonb_agg('loc/' || x) from unnest(b_sites) x), '[]'::jsonb), 'renamed_units', '[]'::jsonb);
end $$;
revoke all on function hub_private.link_clients(uuid, uuid) from public, anon, authenticated;

create or replace function hub_private.unlink_site(p_account uuid, p_site uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  a public.clients; si public.sites; n_id uuid; lg hub_private.location_moves; auto uuid; nsites int;
  moved_tvs uuid[]; pl record; np uuid; copied int := 0;
begin
  select * into si from public.sites where id = p_site for update;
  if not found then raise exception 'Location not found: loc/%', p_site; end if;
  select * into a from public.clients where id = p_account for update;
  if si.client_id is distinct from p_account then
    select * into lg from hub_private.location_moves where action = 'unlink' and from_account = p_account and site = p_site
     order by id desc limit 1;
    if lg.id is not null and lg.into_account = si.client_id then
      return jsonb_build_object('ok', true, 'account', si.client_id::text, 'from', p_account::text, 'site', 'loc/' || p_site,
                                'already', true, 'renamed_units', '[]'::jsonb);
    end if;
    if a.id is null then raise exception 'Account not found: %', p_account; end if;
    raise exception 'That location is not in account %.', p_account;
  end if;
  select count(*) into nsites from public.sites where client_id = a.id;
  if nsites <= 1 then raise exception '% has only that one location, so there is nothing to unlink.', a.name; end if;

  perform set_config('pv.moving_locations', '1', true);
  insert into public.clients (name, notes, site_name, contact_email, require_approval, self_signup)
  values (si.name, concat_ws(E'\n', 'Unlinked from ' || a.name || ' in the licence portal', nullif(a.notes, '')), si.name,
          a.contact_email, a.require_approval, false)
  returning id into n_id;
  select id into auto from public.sites where client_id = n_id;   -- the one its trigger made: replaced by the moved location
  update public.sites set client_id = n_id where id = si.id;
  update public.screens set site_id = si.id where site_id = auto;
  delete from public.sites where id = auto;

  -- members who can see this location are copied (A keeps them)
  insert into public.client_members (client_id, user_id, role, created_at, site_ids, features)
    select n_id, m.user_id, m.role, m.created_at, case when m.site_ids is null then null else array[si.id] end, m.features
      from public.client_members m
     where m.client_id = a.id and (m.role = 'manager' or m.site_ids is null or si.id = any(m.site_ids))
    on conflict (client_id, user_id) do nothing;
  update public.client_members set site_ids = array_remove(site_ids, si.id) where client_id = a.id and si.id = any(site_ids);

  -- content that is only for this location moves with it
  update public.playlists set client_id = n_id where client_id = a.id and cardinality(coalesce(site_ids, '{}')) > 0 and site_ids <@ array[si.id];
  update public.media set client_id = n_id where client_id = a.id and cardinality(coalesce(site_ids, '{}')) > 0 and site_ids <@ array[si.id];
  insert into public.media_folder_clients (folder, client_id)
    select distinct split_part(md.path, '/', 1), n_id from public.media md where md.client_id = n_id on conflict do nothing;
  update public.playlist_pauses pp set client_id = n_id from public.playlists p where p.id = pp.playlist_id and p.client_id = n_id;
  update public.overrides set client_id = n_id where client_id = a.id and site_id = si.id;

  -- its TVs, with their schedules, stats and notifications
  select coalesce(array_agg(id), '{}') into moved_tvs from public.screens where client_id = a.id and site_id = si.id;
  -- a playlist the moved TVs use that is still shared with A's other locations: N gets its own copy
  for pl in select distinct p.* from public.playlists p
             where p.client_id = a.id and (p.id in (select default_playlist_id from public.screens where id = any(moved_tvs))
                or p.id in (select unnest(also_playlist_ids) from public.screens where id = any(moved_tvs))
                or p.id in (select playlist_id from public.schedule_items where screen_id = any(moved_tvs))) loop
    insert into public.playlists (client_id, name, slides, settings, created_at, updated_at, site_ids)
    values (n_id, pl.name, pl.slides, pl.settings, pl.created_at, now(), array[si.id]) returning id into np;
    update public.screens set default_playlist_id = np where id = any(moved_tvs) and default_playlist_id = pl.id;
    update public.screens set also_playlist_ids = array_replace(also_playlist_ids, pl.id, np) where id = any(moved_tvs) and pl.id = any(also_playlist_ids);
    update public.schedule_items set playlist_id = np where screen_id = any(moved_tvs) and playlist_id = pl.id;
    -- the copy shows the same files: their folders are readable by N's TVs and people (rows stay A's)
    insert into public.media_folder_clients (folder, client_id)
      select distinct split_part(md.path, '/', 1), n_id from public.media md
       where md.client_id = a.id and pl.slides::text like '%' || md.id::text || '%' on conflict do nothing;
    copied := copied + 1;
  end loop;
  update public.screens set client_id = n_id where id = any(moved_tvs);
  update public.schedule_items set client_id = n_id where screen_id = any(moved_tvs);
  update public.play_stats set client_id = n_id where screen_id = any(moved_tvs);
  update public.notifications set client_id = n_id where screen_id = any(moved_tvs);
  update public.payments set client_id = n_id where screen_id = any(moved_tvs);

  insert into hub_private.location_moves (action, from_account, into_account, site, sites, details)
  values ('unlink', a.id, n_id, si.id, array[si.id], jsonb_build_object('from_name', a.name, 'site_name', si.name,
          'tvs', cardinality(moved_tvs), 'copied_playlists', copied));
  perform set_config('pv.moving_locations', '', true);
  return jsonb_build_object('ok', true, 'account', n_id::text, 'from', a.id::text, 'site', 'loc/' || si.id,
                            'already', false, 'renamed_units', '[]'::jsonb, 'tvs', cardinality(moved_tvs), 'copied_playlists', copied);
end $$;
revoke all on function hub_private.unlink_site(uuid, uuid) from public, anon, authenticated;

-- 4) Move the live hub_call aside, untouched, as hub_private.hub_call_pre_link (not callable by the API).
do $$
declare src text := (select prosrc from pg_proc where oid = to_regprocedure('public.hub_call(text,text,jsonb)'));
begin
  if src is null then raise exception 'public.hub_call(text,text,jsonb) is missing.'; end if;
  if position('hub_private.hub_call_pre_link' in src) = 0 then
    drop function if exists hub_private.hub_call_pre_link(text, text, jsonb);
    alter function public.hub_call(text, text, jsonb) rename to hub_call_pre_link;
    alter function public.hub_call_pre_link(text, text, jsonb) set schema hub_private;
  end if;
end $$;
revoke all on function hub_private.hub_call_pre_link(text, text, jsonb) from public, anon, authenticated;

-- 5) hub_call: 'link' and 'unlink' here, every other action exactly as before.
create or replace function public.hub_call(p_token text, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a uuid; b uuid; s text;
begin
  if p_action is distinct from 'link' and p_action is distinct from 'unlink' then
    return hub_private.hub_call_pre_link(p_token, p_action, p_args);
  end if;
  if p_token is null or encode(extensions.digest(p_token, 'sha256'), 'hex') is distinct from (select token_sha256 from hub_private.config where id = 1) then
    raise exception 'not authorised';
  end if;
  if p_action = 'link' then
    if nullif(trim(coalesce(p_args->>'into', '')), '') is null or nullif(trim(coalesce(p_args->>'from', '')), '') is null then
      raise exception 'Say which accounts to link (into and from).';
    end if;
    begin a := trim(p_args->>'into')::uuid; exception when others then raise exception 'Account not found: %', p_args->>'into'; end;
    begin b := trim(p_args->>'from')::uuid; exception when others then raise exception 'Account not found: %', p_args->>'from'; end;
    return hub_private.link_clients(a, b);
  end if;
  s := trim(coalesce(p_args->>'site', ''));
  if nullif(trim(coalesce(p_args->>'account', '')), '') is null or s = '' then
    raise exception 'Say which account and location to unlink.';
  end if;
  begin a := trim(p_args->>'account')::uuid; exception when others then raise exception 'Account not found: %', p_args->>'account'; end;
  begin b := (case when s like 'loc/%' then substr(s, 5) else s end)::uuid; exception when others then raise exception 'Location not found: %', s; end;
  return hub_private.unlink_site(a, b);
end $$;
revoke all on function public.hub_call(text, text, jsonb) from public;
grant execute on function public.hub_call(text, text, jsonb) to anon, authenticated;
