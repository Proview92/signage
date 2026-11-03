-- =====================================================================
--  PROVIEW SIGNAGE — feature pack
--  media folders · split-screen side playlists · emergency overrides ·
--  activity log · publish approvals · proof-of-play · TV screenshots
--  Run after 006_sites.sql. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Media folders
-- ---------------------------------------------------------------------
alter table public.media add column if not exists folder text;
create index if not exists media_folder_idx on public.media(client_id, folder);

-- ---------------------------------------------------------------------
--  Screen content: also include side-panel playlists used by layouts
-- ---------------------------------------------------------------------
create or replace function public._build_screen_content(p_screen uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.screens;
  ids uuid[];
begin
  select * into s from public.screens where id = p_screen;
  ids := array(
    select distinct x from (
      select s.default_playlist_id as x
      union all
      select playlist_id from public.schedule_items where screen_id = p_screen and enabled
    ) q where x is not null);
  if s.default_playlist_id is null and not exists
     (select 1 from public.schedule_items where screen_id = p_screen and enabled) then
    return null;
  end if;
  -- side panels referenced by those playlists' layouts
  ids := ids || array(
    select distinct (p.settings ->> 'side_playlist_id')::uuid
      from public.playlists p
     where p.id = any(ids) and p.client_id = s.client_id
       and coalesce(p.settings ->> 'side_playlist_id', '') ~ '^[0-9a-f-]{36}$');
  return jsonb_build_object(
    'version',  extract(epoch from clock_timestamp()),
    'default',  s.default_playlist_id,
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

-- ---------------------------------------------------------------------
--  Emergency overrides (all TVs / one client / one site)
-- ---------------------------------------------------------------------
create table if not exists public.overrides (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null check (scope in ('all', 'client', 'site')),
  client_id   uuid references public.clients(id) on delete cascade,
  site_id     uuid references public.sites(id) on delete cascade,
  message     text not null,
  subtitle    text,
  style       text not null default 'red' check (style in ('red', 'orange', 'blue', 'black', 'green')),
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  active      boolean not null default true,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  check ((scope = 'all' and client_id is null) or (scope = 'client' and client_id is not null) or (scope = 'site' and client_id is not null and site_id is not null))
);
create index if not exists overrides_active_idx on public.overrides(active, starts_at);
alter table public.overrides enable row level security;

drop policy if exists overrides_read on public.overrides;
create policy overrides_read on public.overrides for select to authenticated using (
  public.is_admin()
  or (client_id is not null and public.is_member(client_id))
  or exists (select 1 from public.screens s where s.device_user_id = auth.uid() and s.claimed
             and (overrides.scope = 'all'
                  or (overrides.scope = 'client' and s.client_id = overrides.client_id)
                  or (overrides.scope = 'site' and s.site_id = overrides.site_id))));
drop policy if exists overrides_write on public.overrides;
create policy overrides_write on public.overrides for all to authenticated
  using (public.is_admin() or (scope <> 'all' and client_id is not null and public.is_member(client_id)))
  with check (public.is_admin() or (scope <> 'all' and client_id is not null and public.is_member(client_id)));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'overrides') then
    alter publication supabase_realtime add table public.overrides;
  end if;
end $$;

-- ---------------------------------------------------------------------
--  Activity log
-- ---------------------------------------------------------------------
create table if not exists public.activity (
  id           bigserial primary key,
  client_id    uuid references public.clients(id) on delete cascade,
  user_id      uuid,
  email        text,
  action       text not null,
  entity       text not null,
  entity_id    text,
  entity_name  text,
  details      text,
  at           timestamptz not null default now()
);
create index if not exists activity_client_idx on public.activity(client_id, at desc);
alter table public.activity enable row level security;
drop policy if exists activity_read on public.activity;
create policy activity_read on public.activity for select to authenticated
  using (public.is_admin() or (client_id is not null and public.is_member(client_id)));

create or replace function public.log_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  act text := lower(tg_op) || 'd';
  ent text := tg_argv[0];
  cid uuid;
  nm text;
  det text := null;
  changed text[];
begin
  -- only log people, not TVs or background jobs
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return coalesce(new, old);
  end if;
  if act = 'insertd' then act := 'created'; elsif act = 'updated' then act := 'updated'; else act := 'deleted'; end if;

  cid := case when ent = 'client' then (r ->> 'id')::uuid else nullif(r ->> 'client_id', '')::uuid end;
  nm := coalesce(r ->> 'name', r ->> 'label', r ->> 'email', r ->> 'message');

  if tg_op = 'UPDATE' then
    select array_agg(k) into changed
      from jsonb_object_keys(r) k
     where r -> k is distinct from o -> k
       and k not in ('updated_at', 'last_seen', 'device_info', 'schedule_updated_at', 'hardware_id', 'pairing_code', 'created_at');
    if changed is null then return new; end if;
    if ent = 'screen' then
      if changed = array['content'] or changed <@ array['content', 'published_at'] then act := 'published'; det := null;
      elsif changed && array['license_type', 'license_expires_at'] then act := 'licence changed';
        det := coalesce(r ->> 'license_type', 'none') || coalesce(' until ' || to_char((r ->> 'license_expires_at')::timestamptz, 'DD Mon YYYY'), '');
      elsif changed <@ array['screenshot_requested_at', 'screenshot_at', 'screenshot_path', 'reload_at'] then return new;
      else det := array_to_string(changed, ', ');
      end if;
    elsif ent = 'playlist' then
      det := case when changed <@ array['slides'] then 'slides edited' else array_to_string(changed, ', ') end;
    else
      det := array_to_string(changed, ', ');
    end if;
    -- collapse rapid autosaves of the same thing by the same person
    if exists (select 1 from public.activity a where a.entity = ent and a.entity_id = r ->> 'id' and a.user_id = auth.uid()
                and a.action = act and a.at > now() - interval '10 minutes') then
      update public.activity set at = now(), details = det, entity_name = nm
       where id = (select id from public.activity a where a.entity = ent and a.entity_id = r ->> 'id' and a.user_id = auth.uid()
                    and a.action = act order by at desc limit 1);
      return new;
    end if;
  end if;

  insert into public.activity (client_id, user_id, email, action, entity, entity_id, entity_name, details)
  values (cid, auth.uid(), auth.jwt() ->> 'email', act, ent, r ->> 'id', nm, det);
  return coalesce(new, old);
exception when others then
  return coalesce(new, old);   -- never block the real change
end;
$$;

do $$
declare t text; e text;
begin
  for t, e in select * from (values ('playlists','playlist'), ('media','media'), ('schedule_items','schedule rule'), ('screens','screen'),
                                     ('sites','site'), ('clients','client'), ('invites','invite'), ('overrides','emergency message')) v(t, e)
  loop
    execute format('drop trigger if exists %I on public.%I', 'zz_activity_' || t, t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.log_activity(%L)', 'zz_activity_' || t, t, e);
  end loop;
end $$;

-- ---------------------------------------------------------------------
--  Publish approvals: editors' publishes wait for a manager
-- ---------------------------------------------------------------------
alter table public.clients add column if not exists require_approval boolean not null default false;

create table if not exists public.approval_requests (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  kind          text not null check (kind in ('screen', 'playlist')),
  target_id     uuid not null,
  target_name   text,
  note          text,
  requested_by  uuid default auth.uid() references auth.users(id) on delete set null,
  requested_email text default (auth.jwt() ->> 'email'),
  requested_at  timestamptz not null default now(),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by    uuid references auth.users(id) on delete set null,
  decided_at    timestamptz,
  decision_note text
);
create index if not exists approval_client_idx on public.approval_requests(client_id, status, requested_at desc);
alter table public.approval_requests enable row level security;
drop policy if exists approvals_read on public.approval_requests;
create policy approvals_read on public.approval_requests for select to authenticated using (public.is_member(client_id));
drop policy if exists approvals_insert on public.approval_requests;
create policy approvals_insert on public.approval_requests for insert to authenticated
  with check (public.is_member(client_id) and status = 'pending');

create or replace function public.needs_approval(p_client uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select require_approval from public.clients where id = p_client), false)
     and not public.is_member(p_client, array['manager']);
$$;

create or replace function public.publish_screen(p_screen uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s public.screens;
begin
  select * into s from public.screens where id = p_screen;
  if s.client_id is null or not public.is_member(s.client_id) then raise exception 'screen not found'; end if;
  if public.needs_approval(s.client_id) then raise exception 'APPROVAL_REQUIRED'; end if;
  if not public.license_ok(s.license_type, s.license_expires_at) then
    raise exception 'The licence for "%" has expired. Contact Proview to renew it.', s.name;
  end if;
  update public.screens set content = public._build_screen_content(p_screen), published_at = now() where id = p_screen;
end;
$$;

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

-- Manager decides; approving publishes the current drafts.
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
      for sid in
        select id from public.screens
         where client_id = r.client_id and public.license_ok(license_type, license_expires_at)
           and (default_playlist_id = r.target_id or id in (select screen_id from public.schedule_items where playlist_id = r.target_id))
      loop
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

create or replace function public.set_require_approval(p_client uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_client, array['manager']) then raise exception 'Only managers can change this.'; end if;
  update public.clients set require_approval = p_on where id = p_client;
end;
$$;

-- whoami: + require_approval
create or replace function public.whoami()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id',  auth.uid(),
    'email',    auth.jwt() ->> 'email',
    'is_admin', public.is_admin(),
    'clients',  coalesce((
       select jsonb_agg(jsonb_build_object(
                'id', c.id, 'name', c.name, 'contact_email', c.contact_email, 'require_approval', c.require_approval,
                'role', case when public.is_admin() then coalesce(m.role, 'admin') else m.role end)
              order by lower(c.name))
         from public.clients c
         left join public.client_members m on m.client_id = c.id and m.user_id = auth.uid()
        where public.is_admin() or m.user_id is not null), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------
--  Proof-of-play: TVs report hourly play counts per slide
-- ---------------------------------------------------------------------
create table if not exists public.play_stats (
  id           bigserial primary key,
  client_id    uuid not null references public.clients(id) on delete cascade,
  screen_id    uuid not null references public.screens(id) on delete cascade,
  site_id      uuid,
  hour         timestamptz not null,
  playlist_id  uuid,
  playlist_name text,
  slide_id     text not null,
  slide_name   text,
  slide_type   text,
  media_id     uuid,
  plays        int not null default 0,
  seconds      int not null default 0,
  unique (screen_id, hour, slide_id)
);
create index if not exists play_stats_client_idx on public.play_stats(client_id, hour);
alter table public.play_stats enable row level security;
drop policy if exists play_stats_read on public.play_stats;
create policy play_stats_read on public.play_stats for select to authenticated
  using (public.is_admin() or public.is_member(client_id));

create or replace function public.log_plays(p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  s public.screens;
  x jsonb;
  n int := 0;
begin
  select * into s from public.screens where device_user_id = auth.uid() and claimed and client_id is not null;
  if not found then return 0; end if;
  for x in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    insert into public.play_stats (client_id, screen_id, site_id, hour, playlist_id, playlist_name, slide_id, slide_name, slide_type, media_id, plays, seconds)
    values (s.client_id, s.id, s.site_id, date_trunc('hour', (x ->> 'hour')::timestamptz),
            nullif(x ->> 'playlist_id', '')::uuid, left(x ->> 'playlist_name', 200), left(x ->> 'slide_id', 80), left(x ->> 'slide_name', 200),
            left(x ->> 'slide_type', 20), nullif(x ->> 'media_id', '')::uuid,
            greatest(0, least(100000, (x ->> 'plays')::int)), greatest(0, least(3600 * 24, (x ->> 'seconds')::int)))
    on conflict (screen_id, hour, slide_id) do update
      set plays = play_stats.plays + excluded.plays, seconds = play_stats.seconds + excluded.seconds;
    n := n + 1;
  end loop;
  return n;
exception when others then
  return n;
end;
$$;
revoke all on function public.log_plays(jsonb) from public, anon;
grant execute on function public.log_plays(jsonb) to authenticated;

-- ---------------------------------------------------------------------
--  TV screenshots
-- ---------------------------------------------------------------------
alter table public.screens add column if not exists screenshot_requested_at timestamptz;
alter table public.screens add column if not exists screenshot_at timestamptz;
alter table public.screens add column if not exists screenshot_path text;
alter table public.screens add column if not exists screenshot_error text;

insert into storage.buckets (id, name, public, allowed_mime_types)
values ('screenshots', 'screenshots', false, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

drop policy if exists screenshots_tv_write on storage.objects;
create policy screenshots_tv_write on storage.objects for insert to authenticated
  with check (bucket_id = 'screenshots' and exists (
    select 1 from public.screens s where s.device_user_id = auth.uid() and storage.objects.name = s.id::text || '.jpg'));
drop policy if exists screenshots_tv_update on storage.objects;
create policy screenshots_tv_update on storage.objects for update to authenticated
  using (bucket_id = 'screenshots' and exists (
    select 1 from public.screens s where s.device_user_id = auth.uid() and storage.objects.name = s.id::text || '.jpg'));
drop policy if exists screenshots_tv_read on storage.objects;
create policy screenshots_tv_read on storage.objects for select to authenticated
  using (bucket_id = 'screenshots' and (
    exists (select 1 from public.screens s where s.device_user_id = auth.uid() and storage.objects.name = s.id::text || '.jpg')
    or exists (select 1 from public.screens s where storage.objects.name = s.id::text || '.jpg'
               and (public.is_admin() or (s.client_id is not null and public.is_member(s.client_id))))));

create or replace function public.screenshot_done(p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.screens
     set screenshot_at = case when p_ok then now() else screenshot_at end,
         screenshot_path = case when p_ok then id::text || '.jpg' else screenshot_path end,
         screenshot_error = case when p_ok then null else left(coalesce(p_error, 'Failed'), 200) end,
         screenshot_requested_at = null
   where device_user_id = auth.uid();
end;
$$;
revoke all on function public.screenshot_done(boolean, text) from public, anon;
grant execute on function public.screenshot_done(boolean, text) to authenticated;

-- Members may request a screenshot / reload (not protected by screens_guard).
