-- =====================================================================
--  Signage — Supabase schema (multi-client)
--  Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
--  Safe to re-run.
--
--  Model
--    admin (you)      sees and manages everything
--    clients          each client has its own TVs, media, playlists, schedules
--    client_members   users of a client: 'manager' (can invite & pair TVs)
--                     or 'editor' (content & schedules only)
--    screens          one per TV; TV signs in anonymously, is claimed with a
--                     pairing code and assigned to a client
--    schedule_items   per-TV rules: play playlist X on these days/times/dates
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
--  Tables
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  notes       text,
  created_at  timestamptz not null default now()
);

create table if not exists public.client_members (
  client_id   uuid not null references public.clients(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'editor' check (role in ('manager', 'editor')),
  created_at  timestamptz not null default now(),
  primary key (client_id, user_id)
);
create index if not exists client_members_user_idx on public.client_members(user_id);

create table if not exists public.invites (
  id           uuid primary key default gen_random_uuid(),
  token        text not null unique default encode(gen_random_bytes(18), 'hex'),
  client_id    uuid not null references public.clients(id) on delete cascade,
  email        text not null,
  role         text not null default 'editor' check (role in ('manager', 'editor')),
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users(id) on delete set null
);
create index if not exists invites_client_idx on public.invites(client_id);

-- Files live in storage bucket "media" at <client_id>/<uuid>.<ext>
create table if not exists public.media (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  uploaded_by  uuid default auth.uid() references auth.users(id) on delete set null,
  name         text not null,
  path         text not null unique,
  kind         text not null check (kind in ('image', 'video')),
  mime         text,
  size_bytes   bigint,
  width        int,
  height       int,
  duration_s   numeric,
  created_at   timestamptz not null default now()
);
create index if not exists media_client_idx on public.media(client_id, created_at desc);

-- Editable draft. Screens receive a snapshot when published.
create table if not exists public.playlists (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  name        text not null default 'Untitled playlist',
  slides      jsonb not null default '[]'::jsonb,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists playlists_client_idx on public.playlists(client_id, updated_at desc);

create table if not exists public.screens (
  id                   uuid primary key default gen_random_uuid(),
  device_user_id       uuid not null unique references auth.users(id) on delete cascade,
  client_id            uuid references public.clients(id) on delete set null,
  claimed              boolean not null default false,
  name                 text not null default 'New screen',
  location             text,
  pairing_code         text unique,
  default_playlist_id  uuid references public.playlists(id) on delete set null,
  content              jsonb,          -- published snapshot the TV plays
  published_at         timestamptz,
  schedule_updated_at  timestamptz,    -- bumped when schedule/default changes
  reload_at            timestamptz,    -- bump to force the TV to reload
  last_seen            timestamptz,
  device_info          jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now()
);
create index if not exists screens_client_idx on public.screens(client_id);

-- Per-TV schedule. Times are local to the TV. NULL = no restriction.
create table if not exists public.schedule_items (
  id           uuid primary key default gen_random_uuid(),
  screen_id    uuid not null references public.screens(id) on delete cascade,
  client_id    uuid not null references public.clients(id) on delete cascade,
  playlist_id  uuid not null references public.playlists(id) on delete cascade,
  label        text,
  days         int[],                  -- 0=Sun … 6=Sat; null/empty = every day
  start_time   time,                   -- null = start of day
  end_time     time,                   -- null = end of day; may wrap past midnight
  start_date   date,
  end_date     date,
  priority     int not null default 0, -- higher wins when rules overlap
  enabled      boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists schedule_items_screen_idx on public.schedule_items(screen_id);

-- ---------------------------------------------------------------------
--  Helpers (security definer so policies don't recurse)
-- ---------------------------------------------------------------------
create or replace function public.is_real_user()
returns boolean language sql stable as $$
  select auth.uid() is not null
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false;
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_real_user()
     and exists (select 1 from public.profiles where id = auth.uid() and is_admin);
$$;

-- Member of a client (optionally with one of the given roles). Admins always pass.
create or replace function public.is_member(p_client uuid, p_roles text[] default null)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (public.is_real_user() and exists (
            select 1 from public.client_members m
             where m.client_id = p_client and m.user_id = auth.uid()
               and (p_roles is null or m.role = any(p_roles))));
$$;

create or replace function public.is_member_folder(p_folder text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (public.is_real_user() and exists (
            select 1 from public.client_members m
             where m.client_id::text = p_folder and m.user_id = auth.uid()));
$$;

create or replace function public.gen_pairing_code()
returns text language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.screens where pairing_code = code);
  end loop;
  return code;
end;
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

-- ---------------------------------------------------------------------
--  Triggers
-- ---------------------------------------------------------------------

-- Profile row for every real (non-anonymous) user.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce((to_jsonb(new) ->> 'is_anonymous')::boolean, false) then
    return new;
  end if;
  insert into public.profiles (id, email) values (new.id, to_jsonb(new) ->> 'email')
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert or update of email on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists playlists_touch on public.playlists;
create trigger playlists_touch before update on public.playlists
  for each row execute function public.touch_updated_at();

drop trigger if exists schedule_items_touch on public.schedule_items;
create trigger schedule_items_touch before update on public.schedule_items
  for each row execute function public.touch_updated_at();

-- Keep schedule rows consistent with their screen & client, and flag the
-- screen as having unpublished schedule changes.
create or replace function public.schedule_items_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sc uuid; pc uuid;
begin
  if tg_op = 'DELETE' then
    update public.screens set schedule_updated_at = now() where id = old.screen_id;
    return old;
  end if;
  select client_id into sc from public.screens where id = new.screen_id;
  select client_id into pc from public.playlists where id = new.playlist_id;
  if sc is null or sc <> new.client_id or pc <> new.client_id then
    raise exception 'screen, playlist and schedule must belong to the same client';
  end if;
  update public.screens set schedule_updated_at = now() where id = new.screen_id;
  return new;
end;
$$;
drop trigger if exists schedule_items_guard on public.schedule_items;
create trigger schedule_items_guard before insert or update or delete on public.schedule_items
  for each row execute function public.schedule_items_guard();

-- Non-admins can't move a screen to another client or touch device fields.
create or replace function public.screens_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    -- security-definer RPCs run as owner; they do their own checks
    null;
  elsif not public.is_admin() then
    if new.client_id is distinct from old.client_id
       or new.device_user_id is distinct from old.device_user_id
       or new.claimed is distinct from old.claimed
       or new.content is distinct from old.content
       or new.pairing_code is distinct from old.pairing_code then
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
  return new;
end;
$$;
drop trigger if exists screens_guard on public.screens;
create trigger screens_guard before update on public.screens
  for each row execute function public.screens_guard();

-- ---------------------------------------------------------------------
--  Row-level security
-- ---------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.clients         enable row level security;
alter table public.client_members  enable row level security;
alter table public.invites         enable row level security;
alter table public.media           enable row level security;
alter table public.playlists       enable row level security;
alter table public.screens         enable row level security;
alter table public.schedule_items  enable row level security;

-- profiles: see yourself; admins see everyone
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- clients: members read; admin writes
drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients for select to authenticated
  using (public.is_member(id));
drop policy if exists clients_admin_write on public.clients;
create policy clients_admin_write on public.clients for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- members: colleagues can see each other; managers/admin manage
drop policy if exists members_select on public.client_members;
create policy members_select on public.client_members for select to authenticated
  using (public.is_member(client_id));
drop policy if exists members_manage on public.client_members;
create policy members_manage on public.client_members for update to authenticated
  using (public.is_member(client_id, array['manager'])) with check (public.is_member(client_id, array['manager']));
drop policy if exists members_delete on public.client_members;
create policy members_delete on public.client_members for delete to authenticated
  using (public.is_member(client_id, array['manager']) or user_id = auth.uid());

-- invites: managers/admin
drop policy if exists invites_manage on public.invites;
create policy invites_manage on public.invites for all to authenticated
  using (public.is_member(client_id, array['manager']))
  with check (public.is_member(client_id, array['manager']));

-- content: any member of the client
drop policy if exists media_member on public.media;
create policy media_member on public.media for all to authenticated
  using (public.is_member(client_id)) with check (public.is_member(client_id));

drop policy if exists playlists_member on public.playlists;
create policy playlists_member on public.playlists for all to authenticated
  using (public.is_member(client_id)) with check (public.is_member(client_id));

drop policy if exists schedule_member on public.schedule_items;
create policy schedule_member on public.schedule_items for all to authenticated
  using (public.is_member(client_id)) with check (public.is_member(client_id));

-- screens
drop policy if exists screens_member_select on public.screens;
create policy screens_member_select on public.screens for select to authenticated
  using (public.is_admin() or (client_id is not null and public.is_member(client_id)));
drop policy if exists screens_member_update on public.screens;
create policy screens_member_update on public.screens for update to authenticated
  using (public.is_admin() or (client_id is not null and public.is_member(client_id)))
  with check (public.is_admin() or (client_id is not null and public.is_member(client_id)));
drop policy if exists screens_admin_delete on public.screens;
create policy screens_admin_delete on public.screens for delete to authenticated
  using (public.is_admin());
drop policy if exists screens_device_select on public.screens;
create policy screens_device_select on public.screens for select to authenticated
  using (device_user_id = auth.uid());

-- ---------------------------------------------------------------------
--  RPC: account
-- ---------------------------------------------------------------------
create or replace function public.whoami()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id',  auth.uid(),
    'email',    auth.jwt() ->> 'email',
    'is_admin', public.is_admin(),
    'clients',  coalesce((
       select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'role',
                case when public.is_admin() then coalesce(m.role, 'admin') else m.role end)
              order by c.name)
         from public.clients c
         left join public.client_members m on m.client_id = c.id and m.user_id = auth.uid()
        where public.is_admin() or m.user_id is not null), '[]'::jsonb)
  );
$$;

create or replace function public.accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
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
  insert into public.client_members (client_id, user_id, role)
  values (i.client_id, auth.uid(), i.role)
  on conflict (client_id, user_id) do update set role = excluded.role;
  update public.invites set accepted_at = now(), accepted_by = auth.uid() where id = i.id;
  return i.client_id;
end;
$$;

-- Members of a client with their emails (for the Team page).
create or replace function public.list_members(p_client uuid)
returns table (user_id uuid, email text, role text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, p.email, m.role, m.created_at
    from public.client_members m
    left join public.profiles p on p.id = m.user_id
   where m.client_id = p_client and public.is_member(p_client)
   order by m.created_at;
$$;

-- Invite details for the join page (only reveals the client name & email).
create or replace function public.invite_info(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('client', c.name, 'email', i.email, 'role', i.role,
                            'used', i.accepted_at is not null)
    from public.invites i join public.clients c on c.id = i.client_id
   where i.token = p_token;
$$;

-- ---------------------------------------------------------------------
--  RPC: screens
-- ---------------------------------------------------------------------

-- TV (anonymous session): create or fetch its screen row.
create or replace function public.register_device(p_info jsonb default '{}'::jsonb)
returns public.screens language plpgsql security definer set search_path = public as $$
declare
  s public.screens;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into s from public.screens where device_user_id = auth.uid();
  if not found then
    insert into public.screens (device_user_id, pairing_code, device_info, last_seen)
    values (auth.uid(), public.gen_pairing_code(), coalesce(p_info, '{}'), now())
    returning * into s;
  else
    update public.screens
       set last_seen = now(),
           device_info = device_info || coalesce(p_info, '{}'),
           pairing_code = case
             when not claimed and (pairing_code is null or created_at < now() - interval '1 hour')
               then public.gen_pairing_code() else pairing_code end,
           created_at = case
             when not claimed and created_at < now() - interval '1 hour' then now() else created_at end
     where id = s.id
     returning * into s;
  end if;
  return s;
end;
$$;

-- Dashboard: claim a TV by its code. Admins may leave client null and
-- assign later; client managers pair straight into their client.
create or replace function public.claim_screen(p_code text, p_name text default null, p_client uuid default null)
returns public.screens language plpgsql security definer set search_path = public as $$
declare
  s public.screens;
begin
  if not public.is_real_user() then raise exception 'sign in to pair a screen'; end if;
  if p_client is null and not public.is_admin() then raise exception 'choose a client'; end if;
  if p_client is not null and not public.is_member(p_client, array['manager']) then
    raise exception 'only managers can add screens';
  end if;
  update public.screens
     set claimed = true, client_id = p_client, pairing_code = null,
         name = coalesce(nullif(trim(p_name), ''), name)
   where pairing_code = upper(replace(trim(p_code), ' ', '')) and not claimed
  returning * into s;
  if not found then
    raise exception 'No screen is showing that code. Check the code on the TV and try again.';
  end if;
  return s;
end;
$$;

-- Admin: move a screen to a client (wipes its old client's content).
create or replace function public.assign_screen(p_screen uuid, p_client uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  delete from public.schedule_items where screen_id = p_screen;
  update public.screens
     set client_id = p_client, default_playlist_id = null, content = null,
         published_at = now(), schedule_updated_at = null
   where id = p_screen;
end;
$$;

-- Release a TV back to showing a pairing code.
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
     set claimed = false, client_id = null, default_playlist_id = null, content = null,
         published_at = null, schedule_updated_at = null, name = 'New screen', location = null,
         pairing_code = public.gen_pairing_code(), created_at = now()
   where id = p_screen;
end;
$$;

-- Build the snapshot for one screen: default playlist + schedule rules +
-- every playlist they reference. The TV picks what to play by local time.
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

-- Push a screen's current default + schedule (and playlist drafts) live.
create or replace function public.publish_screen(p_screen uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c uuid;
begin
  select client_id into c from public.screens where id = p_screen;
  if c is null or not public.is_member(c) then raise exception 'screen not found'; end if;
  update public.screens
     set content = public._build_screen_content(p_screen), published_at = now()
   where id = p_screen;
end;
$$;

-- Push a playlist's latest draft to every screen that uses it.
create or replace function public.publish_playlist(p_playlist uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  c uuid; n int := 0; sid uuid;
begin
  select client_id into c from public.playlists where id = p_playlist;
  if c is null or not public.is_member(c) then raise exception 'playlist not found'; end if;
  for sid in
    select id from public.screens where client_id = c and (default_playlist_id = p_playlist
       or id in (select screen_id from public.schedule_items where playlist_id = p_playlist))
  loop
    update public.screens set content = public._build_screen_content(sid), published_at = now() where id = sid;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.screen_heartbeat(p_info jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.screens
     set last_seen = now(), device_info = device_info || coalesce(p_info, '{}')
   where device_user_id = auth.uid();
end;
$$;

-- Permissions on functions
do $$
declare f text;
begin
  foreach f in array array[
    'whoami()', 'accept_invite(text)', 'list_members(uuid)', 'invite_info(text)',
    'register_device(jsonb)', 'claim_screen(text,text,uuid)', 'assign_screen(uuid,uuid)',
    'unpair_screen(uuid)', 'publish_screen(uuid)', 'publish_playlist(uuid)', 'screen_heartbeat(jsonb)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'revoke all on function public._build_screen_content(uuid) from public, anon, authenticated';
  -- the join page shows "You've been invited to <client>" before sign-up
  execute 'grant execute on function public.invite_info(text) to anon';
end $$;

-- ---------------------------------------------------------------------
--  Storage: private "media" bucket, folder per client
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, allowed_mime_types)
values ('media', 'media', false, array['image/*', 'video/*'])
on conflict (id) do nothing;

drop policy if exists media_owner_rw on storage.objects;
drop policy if exists media_member_rw on storage.objects;
create policy media_member_rw on storage.objects for all to authenticated
  using (bucket_id = 'media' and public.is_member_folder((storage.foldername(storage.objects.name))[1]))
  with check (bucket_id = 'media' and public.is_member_folder((storage.foldername(storage.objects.name))[1]));

drop policy if exists media_device_read on storage.objects;
create policy media_device_read on storage.objects for select to authenticated
  using (
    bucket_id = 'media'
    and exists (
      select 1 from public.screens s
       where s.device_user_id = auth.uid()
         and s.client_id::text = (storage.foldername(storage.objects.name))[1]));

-- ---------------------------------------------------------------------
--  Realtime
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'screens') then
    alter publication supabase_realtime add table public.screens;
  end if;
end $$;

-- ---------------------------------------------------------------------
--  Make yourself admin — sign up in the dashboard first, then run:
--    update public.profiles set is_admin = true where email = 'you@example.com';
-- ---------------------------------------------------------------------
