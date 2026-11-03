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
