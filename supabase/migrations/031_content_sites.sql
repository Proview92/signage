-- 031: per-site playlists and media.
--
-- playlists.site_ids / media.site_ids: uuid[]
--   NULL     = shared with every site of the business (what every existing row is, and stays).
--   {a,b}    = only for those sites.
--   {}       = for no site (only Owners/Admins and the master see it; e.g. its only site was deleted).
-- Who sees what (people limited to some sites = Manager/Staff with client_members.site_ids set):
--   Owners/Admins ('manager'), the Proview master and members with every site: everything, as before.
--   Site-limited people: shared items (NULL) + items whose sites overlap theirs. They can only create,
--   change or delete items whose sites are all within their own (so shared items are read-only to them);
--   what they create is tagged with their sites automatically, and they can't widen an item.
-- schedule_items need no site list: each rule belongs to one TV, which is already site-scoped
-- (can_see_screen); new rules / TV playlists must use a playlist the person can see.
-- Storage: media files follow the media row with the same path. TVs keep media_device_read unchanged
-- and still get their playlists through screens.content (built by security-definer functions).

alter table public.playlists add column if not exists site_ids uuid[];
alter table public.media     add column if not exists site_ids uuid[];

-- ------------------------------------------------------------------ helpers
-- The sites this person is limited to in a business; NULL = every site; {} = not a member.
create or replace function public.my_site_ids(p_client uuid) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare m public.client_members;
begin
  if public.is_admin() then return null; end if;
  m := public.my_membership(p_client);
  if m.user_id is null then return '{}'::uuid[]; end if;
  if m.role = 'manager' then return null; end if;
  return m.site_ids;
end $$;

-- Can see an item with this site list (NULL = shared with all sites).
create or replace function public.can_see_sites(p_client uuid, p_sites uuid[]) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare mine uuid[];
begin
  if p_client is null then return public.is_admin(); end if;
  if not public.is_member(p_client) then return false; end if;
  mine := public.my_site_ids(p_client);
  return mine is null or p_sites is null or p_sites && mine;
end $$;

-- Can create / change / delete an item with this site list: every site it covers must be one of yours.
create or replace function public.can_edit_sites(p_client uuid, p_sites uuid[]) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare mine uuid[];
begin
  if p_client is null then return public.is_admin(); end if;
  if not public.is_member(p_client) then return false; end if;
  mine := public.my_site_ids(p_client);
  return mine is null or (p_sites is not null and cardinality(p_sites) > 0 and p_sites <@ mine);
end $$;

create or replace function public.can_see_playlist(p_playlist uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.can_see_sites(p.client_id, p.site_ids) from public.playlists p where p.id = p_playlist), false) $$;

-- Storage files in the media bucket follow their media row (files without a row: folder rule only, as before).
create or replace function public.media_file_visible(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.can_see_sites(m.client_id, m.site_ids) from public.media m where m.path = p_name), true) $$;
create or replace function public.media_file_editable(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.can_edit_sites(m.client_id, m.site_ids) from public.media m where m.path = p_name), true) $$;

revoke execute on function public.my_site_ids(uuid), public.can_see_sites(uuid, uuid[]), public.can_edit_sites(uuid, uuid[]),
  public.can_see_playlist(uuid), public.media_file_visible(text), public.media_file_editable(text) from public, anon;
grant execute on function public.my_site_ids(uuid), public.can_see_sites(uuid, uuid[]), public.can_edit_sites(uuid, uuid[]),
  public.can_see_playlist(uuid), public.media_file_visible(text), public.media_file_editable(text) to authenticated;

-- ------------------------------------------------------------------ tagging guard
create or replace function public.content_sites_guard() returns trigger
language plpgsql set search_path = public as $$
declare mine uuid[];
begin
  if new.site_ids is not null then
    if exists (select 1 from unnest(new.site_ids) x join public.sites s on s.id = x where s.client_id <> new.client_id) then
      raise exception 'That site belongs to a different business.';
    end if;
    -- tidy: no duplicates, forget sites that no longer exist
    new.site_ids := array(select distinct x from unnest(new.site_ids) x where exists (select 1 from public.sites s where s.id = x));
  end if;
  if current_user in ('postgres', 'supabase_admin', 'service_role') or not public.is_real_user() or public.is_admin() then
    return new;
  end if;
  mine := public.my_site_ids(new.client_id);
  if mine is null then return new; end if;            -- Owners/Admins and people with every site
  if tg_op = 'INSERT' and new.site_ids is null then new.site_ids := mine; end if;   -- tag with their sites
  if new.site_ids is null then
    raise exception 'Only an owner or admin can share this with every site.';
  end if;
  if cardinality(new.site_ids) = 0 or not new.site_ids <@ mine then
    raise exception 'You can only choose your own sites.';
  end if;
  return new;
end $$;

create trigger content_sites_guard before insert or update on public.playlists
  for each row execute function public.content_sites_guard();
create trigger content_sites_guard before insert or update on public.media
  for each row execute function public.content_sites_guard();

-- ------------------------------------------------------------------ policies
alter policy playlists_member on public.playlists
  using (public.is_member(client_id) and public.can_see_sites(client_id, site_ids))
  with check (public.is_member(client_id) and public.has_feature(client_id, 'playlists') and public.can_edit_sites(client_id, site_ids));
create policy playlists_site_update on public.playlists as restrictive for update to authenticated
  using (public.can_edit_sites(client_id, site_ids));
create policy playlists_site_delete on public.playlists as restrictive for delete to authenticated
  using (public.can_edit_sites(client_id, site_ids));

alter policy media_member on public.media
  using (public.is_member(client_id) and public.can_see_sites(client_id, site_ids))
  with check (public.is_member(client_id) and public.has_feature(client_id, 'media') and public.can_edit_sites(client_id, site_ids));
create policy media_site_update on public.media as restrictive for update to authenticated
  using (public.can_edit_sites(client_id, site_ids));
create policy media_site_delete on public.media as restrictive for delete to authenticated
  using (public.can_edit_sites(client_id, site_ids));

-- schedule rules may only use a playlist the person can see
alter policy schedule_member on public.schedule_items
  using (public.is_member(client_id) and public.can_see_screen(screen_id))
  with check (public.is_member(client_id) and public.can_see_screen(screen_id) and public.has_feature(client_id, 'schedule')
              and public.can_see_playlist(playlist_id));

alter policy playlist_pauses_read on public.playlist_pauses
  using (public.is_member(client_id) and public.can_see_playlist(playlist_id));

-- storage: media files (TVs keep media_device_read unchanged)
alter policy media_member_rw on storage.objects
  using (bucket_id = 'media' and public.is_member_folder((storage.foldername(name))[1]) and public.media_file_visible(name))
  with check (bucket_id = 'media' and public.is_member_folder((storage.foldername(name))[1])
              and public.has_feature_folder((storage.foldername(name))[1], 'media') and public.media_file_editable(name));
create policy media_site_update on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'media' or public.media_file_editable(name));
create policy media_site_delete on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'media' or public.media_file_editable(name));

-- ------------------------------------------------------------------ functions
-- TV playlists (default / add-ons) chosen by site-limited people must be playlists they can see.
create or replace function public.screens_access_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  n jsonb := to_jsonb(new); o jsonb := to_jsonb(old);
  changed text[];
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') or not public.is_real_user()
     or public.is_admin() or old.client_id is null then
    return new;
  end if;
  select array_agg(k) into changed from jsonb_object_keys(n) k where n -> k is distinct from o -> k;
  if changed is null then return new; end if;
  if changed && array['default_playlist_id', 'also_playlist_ids'] and not public.has_feature(old.client_id, 'schedule') then
    raise exception 'You don''t have access to schedules. Ask your owner or admin.';
  end if;
  if exists (select 1 from unnest(changed) k where k not in ('default_playlist_id', 'also_playlist_ids', 'schedule_updated_at'))
     and not public.has_feature(old.client_id, 'screens') then
    raise exception 'You don''t have access to TV settings. Ask your owner or admin.';
  end if;
  if changed && array['default_playlist_id', 'also_playlist_ids'] and public.my_site_ids(old.client_id) is not null
     and ((new.default_playlist_id is distinct from old.default_playlist_id and new.default_playlist_id is not null
           and not public.can_see_playlist(new.default_playlist_id))
          or exists (select 1 from unnest(coalesce(new.also_playlist_ids, '{}')) x
                      where not (x = any(coalesce(old.also_playlist_ids, '{}'))) and not public.can_see_playlist(x))) then
    raise exception 'That playlist isn''t available for your sites.';
  end if;
  return new;
end $$;

create or replace function public.publish_playlist(p_playlist uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  c uuid; n int := 0; sid uuid;
begin
  select client_id into c from public.playlists where id = p_playlist;
  if c is null or not public.is_member(c) or not public.can_see_playlist(p_playlist) then raise exception 'playlist not found'; end if;
  if not public.has_feature(c, 'playlists') then raise exception 'You don''t have access to playlists. Ask your owner or admin.'; end if;
  if public.needs_approval(c) then raise exception 'APPROVAL_REQUIRED'; end if;
  for sid in select * from public._screens_using_playlist(c, p_playlist) loop
    if public.can_see_screen(sid) then
      update public.screens set content = public._build_screen_content(sid), published_at = now() where id = sid;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
