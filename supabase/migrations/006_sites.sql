-- =====================================================================
--  PROVIEW SIGNAGE — multiple sites per client
--  Run after 005_client_site.sql. Safe to re-run.
--
--  A client (account) has many sites. Media, playlists and users are
--  shared across the client's sites; each TV belongs to one site.
-- =====================================================================

create table if not exists public.sites (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  name        text not null,
  address     text,
  created_at  timestamptz not null default now()
);
create index if not exists sites_client_idx on public.sites(client_id, name);

alter table public.screens add column if not exists site_id uuid references public.sites(id) on delete set null;
create index if not exists screens_site_idx on public.screens(site_id);

alter table public.sites enable row level security;
drop policy if exists sites_select on public.sites;
create policy sites_select on public.sites for select to authenticated
  using (public.is_member(client_id));
drop policy if exists sites_insert on public.sites;
create policy sites_insert on public.sites for insert to authenticated
  with check (public.is_member(client_id, array['manager']));
drop policy if exists sites_update on public.sites;
create policy sites_update on public.sites for update to authenticated
  using (public.is_member(client_id, array['manager']))
  with check (public.is_member(client_id, array['manager']));
drop policy if exists sites_delete on public.sites;
create policy sites_delete on public.sites for delete to authenticated
  using (public.is_member(client_id, array['manager']));

-- A TV's site must belong to the TV's client; moving a TV to another
-- client (or unpairing it) clears its site.
create or replace function public.screens_site_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.client_id is distinct from old.client_id then
    if new.site_id is not null and new.site_id is not distinct from old.site_id then
      new.site_id := null;
    end if;
  end if;
  if new.site_id is not null and not exists (
       select 1 from public.sites s where s.id = new.site_id and s.client_id = new.client_id) then
    raise exception 'That site belongs to a different client.';
  end if;
  return new;
end;
$$;
drop trigger if exists screens_site_guard on public.screens;
create trigger screens_site_guard before insert or update on public.screens
  for each row execute function public.screens_site_guard();

-- Earlier versions stored one "site name" on the client. Turn it into the
-- client's first site, and use it as the client's display name if the
-- client was named by its email address.
insert into public.sites (client_id, name)
select c.id, trim(c.site_name)
  from public.clients c
 where nullif(trim(c.site_name), '') is not null
   and not exists (select 1 from public.sites s where s.client_id = c.id);

update public.clients
   set name = trim(site_name)
 where nullif(trim(site_name), '') is not null
   and name ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';

-- Existing TVs of a client with exactly one site go into that site.
update public.screens sc
   set site_id = s.id
  from public.sites s
 where sc.site_id is null and s.client_id = sc.client_id
   and (select count(*) from public.sites x where x.client_id = sc.client_id) = 1;
