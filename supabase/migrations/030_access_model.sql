-- 030: Proview access model (applied to the live DB as 030a..030e): roles, per-site scope and per-feature switches for client users.
--
-- Roles (stored values unchanged where they already existed):
--   profiles.is_admin    -> Proview master (only altun@proviewtech.co.uk). Sees every business.
--   'manager'            -> Owner / Admin of a business: all its sites, all features, manages users.
--   'site_manager' (new) -> Manager: only their sites (site_ids), features per person, publishes without approval.
--   'editor'             -> Staff: only their sites (site_ids), features per person.
--
-- client_members.site_ids / invites.site_ids: uuid[]; NULL = every site of the business (what existing
--   editors had before this change). Ignored (always NULL) for owners.
-- client_members.features / invites.features: jsonb, e.g. {"media":false}. A missing key = role default
--   (ON for everything except 'billing', i.e. what editors could do before). Ignored for owners.
-- Feature keys (keep in step with FEATURES in web/js/core.js):
--   screens   TV settings (name, site, rotation, sleep, reload, screenshot, video wall)
--   schedule  what plays on each TV (default playlist, add-ons, schedule rules, publish a TV)
--   playlists playlists, templates, publish/pause a playlist
--   media     media library uploads and edits
--   emergency emergency messages (overrides)
--   reports   proof-of-play reports
--   activity  activity log
--   billing   licence payments / renew online (default OFF for Manager & Staff, as before)
-- Users (Team page), sites and pairing TVs stay Owner/Admin only.

-- ------------------------------------------------------------------ columns & roles
alter table public.client_members add column if not exists site_ids uuid[];
alter table public.client_members add column if not exists features jsonb not null default '{}'::jsonb;
alter table public.invites        add column if not exists site_ids uuid[];
alter table public.invites        add column if not exists features jsonb not null default '{}'::jsonb;

alter table public.client_members drop constraint if exists client_members_role_check;
alter table public.client_members add constraint client_members_role_check check (role = any (array['manager', 'site_manager', 'editor']));
alter table public.invites drop constraint if exists invites_role_check;
alter table public.invites add constraint invites_role_check check (role = any (array['manager', 'site_manager', 'editor']));

-- ------------------------------------------------------------------ helpers
create or replace function public.feature_default(p_role text, p_feature text) returns boolean
language sql immutable as $$ select p_feature <> 'billing' $$;

create or replace function public.my_membership(p_client uuid) returns public.client_members
language sql stable security definer set search_path = public as $$
  select m.* from public.client_members m
   where public.is_real_user() and m.client_id = p_client and m.user_id = auth.uid() $$;

create or replace function public.has_feature(p_client uuid, p_feature text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare m public.client_members;
begin
  if public.is_admin() then return true; end if;
  m := public.my_membership(p_client);
  if m.user_id is null then return false; end if;
  if m.role = 'manager' then return true; end if;
  return case m.features ->> p_feature when 'true' then true when 'false' then false
              else public.feature_default(m.role, p_feature) end;
end $$;

-- Can see every site of the business (owner, master, or a member with no site list)
create or replace function public.all_sites(p_client uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare m public.client_members;
begin
  if public.is_admin() then return true; end if;
  m := public.my_membership(p_client);
  if m.user_id is null then return false; end if;
  return m.role = 'manager' or m.site_ids is null;
end $$;

-- Can see this site of the business. p_site null (e.g. a TV not in a site) = only people who see all sites.
create or replace function public.can_site(p_client uuid, p_site uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare m public.client_members;
begin
  if p_client is null then return public.is_admin(); end if;
  if p_site is null then return public.all_sites(p_client); end if;
  if not exists (select 1 from public.sites s where s.id = p_site and s.client_id = p_client) then return false; end if;
  if public.is_admin() then return true; end if;
  m := public.my_membership(p_client);
  if m.user_id is null then return false; end if;
  return m.role = 'manager' or m.site_ids is null or p_site = any(m.site_ids);
end $$;

create or replace function public.can_see_screen(p_screen uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.screens s
     where s.id = p_screen and s.client_id is not null
       and public.is_member(s.client_id) and public.can_site(s.client_id, s.site_id)) $$;

-- storage folders are named after the client id
create or replace function public.has_feature_folder(p_folder text, p_feature text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.clients c where c.id::text = p_folder and public.has_feature(c.id, p_feature)) $$;


-- ------------------------------------------------------------------ membership guards
create or replace function public.access_row_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.role = 'manager' then
    new.site_ids := null;
    new.features := '{}'::jsonb;
  end if;
  if new.features is null or jsonb_typeof(new.features) <> 'object' then new.features := '{}'::jsonb; end if;
  if new.site_ids is not null then
    if exists (select 1 from unnest(new.site_ids) x
                where not exists (select 1 from public.sites s where s.id = x and s.client_id = new.client_id)) then
      raise exception 'That site belongs to a different business.';
    end if;
    new.site_ids := array(select distinct x from unnest(new.site_ids) x);
  end if;
  -- Nobody changes their own role, sites or features (server functions such as accept_invite are trusted).
  if tg_table_name = 'client_members' and tg_op = 'UPDATE' then
    if current_user not in ('postgres', 'supabase_admin', 'service_role')
       and (to_jsonb(new) ->> 'user_id')::uuid = auth.uid() and not public.is_admin()
       and (new.role is distinct from old.role or new.site_ids is distinct from old.site_ids
            or new.features is distinct from old.features or new.client_id is distinct from old.client_id) then
      raise exception 'You can''t change your own access. Ask another owner or admin.';
    end if;
  end if;
  return new;
end $$;

create trigger access_row_guard before insert or update on public.client_members
  for each row execute function public.access_row_guard();
create trigger access_row_guard before insert or update on public.invites
  for each row execute function public.access_row_guard();

-- Screen edits by people: TV settings need 'screens', what plays needs 'schedule'.
-- Named to run before the other BEFORE UPDATE triggers so it sees only what the person changed.
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
  return new;
end $$;
create trigger screens_access_guard before update on public.screens
  for each row execute function public.screens_access_guard();

-- ------------------------------------------------------------------ policies
-- Existing policies are changed in place (ALTER POLICY); deletes get extra RESTRICTIVE feature checks.
alter policy sites_select on public.sites
  using (public.is_member(client_id) and public.can_site(client_id, id));

-- screens (TV devices keep screens_device_select unchanged)
alter policy screens_member_select on public.screens
  using (public.is_admin() or (client_id is not null and public.is_member(client_id) and public.can_site(client_id, site_id)));
alter policy screens_member_update on public.screens
  using (public.is_admin() or (client_id is not null and public.is_member(client_id) and public.can_site(client_id, site_id)))
  with check (public.is_admin() or (client_id is not null and public.is_member(client_id) and public.can_site(client_id, site_id)));

-- schedule rules: only for TVs you can see; changes need 'schedule'
alter policy schedule_member on public.schedule_items
  using (public.is_member(client_id) and public.can_see_screen(screen_id))
  with check (public.is_member(client_id) and public.can_see_screen(screen_id) and public.has_feature(client_id, 'schedule'));
create policy schedule_feature_delete on public.schedule_items as restrictive for delete to authenticated
  using (public.has_feature(client_id, 'schedule'));

-- playlists and media are shared by every site of a business: all members read them, changes need the feature
alter policy playlists_member on public.playlists
  using (public.is_member(client_id))
  with check (public.is_member(client_id) and public.has_feature(client_id, 'playlists'));
create policy playlists_feature_delete on public.playlists as restrictive for delete to authenticated
  using (public.has_feature(client_id, 'playlists'));

alter policy media_member on public.media
  using (public.is_member(client_id))
  with check (public.is_member(client_id) and public.has_feature(client_id, 'media'));
create policy media_feature_delete on public.media as restrictive for delete to authenticated
  using (public.has_feature(client_id, 'media'));

-- emergency messages: business-wide ones need access to every site
alter policy overrides_read on public.overrides
  using (public.is_admin()
         or (client_id is not null and public.is_member(client_id) and (scope <> 'site' or public.can_site(client_id, site_id)))
         or exists (select 1 from public.screens s
                     where s.device_user_id = auth.uid() and s.claimed
                       and (overrides.scope = 'all'
                            or (overrides.scope = 'client' and s.client_id = overrides.client_id)
                            or (overrides.scope = 'site' and s.site_id = overrides.site_id))));
alter policy overrides_write on public.overrides
  using (public.is_admin() or (scope <> 'all' and client_id is not null and public.is_member(client_id)
         and not public.needs_approval(client_id) and public.has_feature(client_id, 'emergency')
         and ((scope = 'client' and public.all_sites(client_id)) or (scope = 'site' and public.can_site(client_id, site_id)))))
  with check (public.is_admin() or (scope <> 'all' and client_id is not null and public.is_member(client_id)
         and not public.needs_approval(client_id) and public.has_feature(client_id, 'emergency')
         and ((scope = 'client' and public.all_sites(client_id)) or (scope = 'site' and public.can_site(client_id, site_id)))));

-- reports, activity, notifications, payments, approvals
alter policy play_stats_read on public.play_stats
  using (public.is_admin() or (public.is_member(client_id) and public.has_feature(client_id, 'reports') and public.can_site(client_id, site_id)));
alter policy activity_read on public.activity
  using (public.is_admin() or (client_id is not null and public.is_member(client_id) and public.has_feature(client_id, 'activity')));
alter policy notifications_read on public.notifications
  using (public.is_admin() or (client_id is not null and public.is_member(client_id) and (screen_id is null or public.can_see_screen(screen_id))));
alter policy payments_read on public.payments
  using (public.is_admin() or (client_id is not null and public.has_feature(client_id, 'billing')
         and (screen_id is null or public.can_see_screen(screen_id))));
alter policy approvals_read on public.approval_requests
  using (public.is_member(client_id) and (kind <> 'screen' or public.can_see_screen(target_id)));

-- storage: media files (TVs keep media_device_read) and TV screenshots
alter policy media_member_rw on storage.objects
  using (bucket_id = 'media' and public.is_member_folder((storage.foldername(name))[1]))
  with check (bucket_id = 'media' and public.is_member_folder((storage.foldername(name))[1])
              and public.has_feature_folder((storage.foldername(name))[1], 'media'));
create policy media_feature_delete on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'media' or public.has_feature_folder((storage.foldername(name))[1], 'media'));
alter policy screenshots_tv_read on storage.objects
  using (bucket_id = 'screenshots' and (
    exists (select 1 from public.screens s where s.device_user_id = auth.uid() and objects.name = s.id::text || '.jpg')
    or exists (select 1 from public.screens s where objects.name = s.id::text || '.jpg' and public.can_see_screen(s.id))));

-- ------------------------------------------------------------------ functions
-- Managers (site_manager) publish without approval, like owners.
create or replace function public.needs_approval(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select require_approval from public.clients where id = p_client), false)
     and not public.is_member(p_client, array['manager', 'site_manager']);
$$;

create or replace function public.publish_screen(p_screen uuid) returns void
language plpgsql security definer set search_path = public as $$
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
  update public.screens set content = public._build_screen_content(p_screen), published_at = now() where id = p_screen;
end;
$$;

-- People limited to some sites only publish to the TVs in those sites.
create or replace function public.publish_playlist(p_playlist uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  c uuid; n int := 0; sid uuid;
begin
  select client_id into c from public.playlists where id = p_playlist;
  if c is null or not public.is_member(c) then raise exception 'playlist not found'; end if;
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

-- Pausing a playlist affects every site, so it needs playlists access to all sites.
create or replace function public.set_playlist_pause(p_playlist uuid, p_until timestamp with time zone)
returns timestamp with time zone
language plpgsql security definer set search_path = public as $$
declare
  c uuid;
  playing boolean := p_until is null or p_until <= now();
begin
  select client_id into c from public.playlists where id = p_playlist;
  if c is null or not public.is_member(c) then raise exception 'playlist not found'; end if;
  if not public.has_feature(c, 'playlists') then raise exception 'You don''t have access to playlists. Ask your owner or admin.'; end if;
  if not public.all_sites(c) then raise exception 'Pausing a playlist changes every site. Ask your owner or admin.'; end if;
  if playing then
    delete from public.playlist_pauses where playlist_id = p_playlist;
    update public.screens set paused_playlists = coalesce(paused_playlists, '{}'::jsonb) - p_playlist::text
     where client_id = c and paused_playlists ? p_playlist::text;
    return null;
  end if;
  insert into public.playlist_pauses (playlist_id, client_id, until) values (p_playlist, c, p_until)
  on conflict (playlist_id) do update set until = excluded.until, set_by = auth.uid(), set_at = now();
  update public.screens
     set paused_playlists = coalesce(paused_playlists, '{}'::jsonb)
         || jsonb_build_object(p_playlist::text, case when p_until = 'infinity' then to_jsonb('stop'::text) else to_jsonb(p_until) end)
   where client_id = c;
  return p_until;
end $$;

-- Invites carry role, sites and features over to the membership.
create or replace function public.accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  i public.invites;
begin
  if not public.is_real_user() then raise exception 'sign in first'; end if;
  select * into i from public.invites where token = p_token;
  if not found then raise exception 'This invite link is not valid.'; end if;
  if i.accepted_at is not null and i.accepted_by is distinct from auth.uid() then
    raise exception 'This invite has already been used.';
  end if;
  if lower(i.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'This invite was sent to %. Sign in with that email address.', i.email;
  end if;
  insert into public.client_members (client_id, user_id, role, site_ids, features)
  values (i.client_id, auth.uid(), i.role, i.site_ids, coalesce(i.features, '{}'::jsonb))
  on conflict (client_id, user_id) do update set role = excluded.role, site_ids = excluded.site_ids, features = excluded.features;
  update public.invites set accepted_at = now(), accepted_by = auth.uid() where id = i.id;
  return i.client_id;
end;
$$;

-- Users page: members with their sites and features (list_members is kept unchanged for older pages)
create or replace function public.list_team(p_client uuid)
returns table(user_id uuid, email text, role text, created_at timestamp with time zone, site_ids uuid[], features jsonb)
language sql stable security definer set search_path = public as $$
  select m.user_id, coalesce(p.email, u.email)::text, m.role, m.created_at, m.site_ids, m.features
    from public.client_members m
    left join public.profiles p on p.id = m.user_id
    left join auth.users u on u.id = m.user_id
   where m.client_id = p_client and public.is_member(p_client)
   order by m.created_at;
$$;
revoke execute on function public.list_team(uuid) from public, anon;
grant execute on function public.list_team(uuid) to authenticated;

create or replace function public.whoami() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id',  auth.uid(),
    'email',    auth.jwt() ->> 'email',
    'is_admin', public.is_admin(),
    'clients',  coalesce((
       select jsonb_agg(jsonb_build_object(
                'id', c.id, 'name', c.name, 'contact_email', c.contact_email, 'require_approval', c.require_approval,
                'self_signup', c.self_signup, 'trial_only', c.self_signup and not public.client_has_paid_licence(c.id),
                'role', case when public.is_admin() then coalesce(m.role, 'admin') else m.role end,
                'site_ids', case when public.is_admin() or m.role = 'manager' then null else to_jsonb(m.site_ids) end,
                'features', case when public.is_admin() or m.role = 'manager' then '{}'::jsonb else coalesce(m.features, '{}'::jsonb) end)
              order by lower(c.name))
         from public.clients c
         left join public.client_members m on m.client_id = c.id and m.user_id = auth.uid()
        where public.is_admin() or m.user_id is not null), '[]'::jsonb)
  );
$$;

create or replace function public.send_invite_email(p_invite uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  i public.invites;
  cname text;
  inviter text := coalesce(auth.jwt() ->> 'email', 'PROVIEW SIGNAGE');
  link text;
  html text;
begin
  select * into i from public.invites where id = p_invite;
  if not found then raise exception 'Invite not found.'; end if;
  if not (public.is_admin() or public.is_member(i.client_id, array['manager'])) then raise exception 'Only owners and admins can send invites.'; end if;
  if i.accepted_at is not null then raise exception 'This invite has already been accepted.'; end if;
  if public._secret('resend_api_key') is null then
    raise exception 'Email sending isn''t set up yet. An admin needs to add the Resend API key in Clients & TVs → Alerts & email. Meanwhile, copy the link and send it yourself.';
  end if;
  select coalesce(nullif(site_name, ''), name) into cname from public.clients where id = i.client_id;
  link := rtrim((select app_url from public.app_settings where id = 1), '/') || '/#/join/' || i.token;
  html := '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;padding:28px 24px;color:#17171c">'
    || '<div style="font-weight:500;letter-spacing:.06em;margin-bottom:22px">PROVIEW<span style="color:#4a6cd0">SIGNAGE</span></div>'
    || '<h2 style="margin:0 0 12px;font-size:22px">You''re invited to manage ' || public._esc(cname) || '’s screens</h2>'
    || '<p style="color:#444;line-height:1.55;margin:0 0 22px">' || public._esc(inviter) || ' has given you <b>'
    || case when i.role = 'manager' then 'owner / admin' when i.role = 'site_manager' then 'manager' else 'staff' end
    || '</b> access to the digital signage for <b>' || public._esc(cname) || '</b>. '
    || 'Create your account with this email address (' || public._esc(i.email) || ') to get started.</p>'
    || '<a href="' || public._esc(link) || '" style="display:inline-block;background:#3d73d3;background-image:linear-gradient(135deg,#2f84d4,#5a5fbb);color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px">Accept invite</a>'
    || '<p style="color:#888;font-size:13px;line-height:1.5;margin:22px 0 0">Or open this link: <br><a href="' || public._esc(link) || '" style="color:#3d73d3;word-break:break-all">' || public._esc(link) || '</a></p>'
    || '<p style="color:#999;font-size:12px;margin-top:30px;border-top:1px solid #eee;padding-top:14px">PROVIEW SIGNAGE · www.proviewsignage.co.uk · Support 020 8935 5495</p></div>';
  if not public._send_email(array[i.email], 'You''re invited to ' || cname || ' on PROVIEW SIGNAGE', html) then
    raise exception 'The email could not be sent. Copy the link and send it yourself.';
  end if;
  update public.invites set emailed_at = now() where id = i.id;
  return true;
end;
$$;

revoke execute on function public.my_membership(uuid), public.has_feature(uuid, text), public.all_sites(uuid), public.can_site(uuid, uuid),
  public.can_see_screen(uuid), public.has_feature_folder(text, text) from public, anon;
grant execute on function public.my_membership(uuid), public.has_feature(uuid, text), public.all_sites(uuid), public.can_site(uuid, uuid),
  public.can_see_screen(uuid), public.has_feature_folder(text, text) to authenticated;
