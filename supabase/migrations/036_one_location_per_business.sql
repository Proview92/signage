-- =====================================================================
--  036: one location per business, named after the business (owner decision 10 Nov 2026)
--  - A new business (from the dashboard, the trial sign-up or the licence portal) gets its location automatically.
--  - Renaming a business renames its location too.
--  - Nobody can add a second location (the master can still remove/rename via SQL if ever needed).
--  - A TV put in a business without a location is placed in that business's location.
--  - Backfill: businesses with no location get one; their TVs and limited users are moved into it.
--  Safe to re-run.
-- =====================================================================

-- 1. new business -> its location
create or replace function public.business_location_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.sites where client_id = new.id) then
    insert into public.sites (client_id, name) values (new.id, coalesce(nullif(trim(new.name), ''), 'Main'));
  end if;
  return new;
end $$;
drop trigger if exists clients_one_location on public.clients;
create trigger clients_one_location after insert on public.clients
  for each row execute function public.business_location_insert();

-- 2. renamed business -> renamed location (while it has just the one)
create or replace function public.business_location_rename() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.name is distinct from old.name and (select count(*) from public.sites where client_id = new.id) = 1 then
    update public.sites set name = coalesce(nullif(trim(new.name), ''), name) where client_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists clients_rename_location on public.clients;
create trigger clients_rename_location after update of name on public.clients
  for each row execute function public.business_location_rename();

-- 3. no second location (the sign-up's own first location and step 1 still work: they run when there is none)
create or replace function public.sites_only_one() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.sites where client_id = new.client_id) then
    raise exception 'Each business has one location, named after the business. It was added automatically.';
  end if;
  return new;
end $$;
drop trigger if exists sites_only_one on public.sites;
create trigger sites_only_one before insert on public.sites
  for each row execute function public.sites_only_one();

-- 4. a TV in a business but in no location -> the business's location
create or replace function public.screens_default_location() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.client_id is not null and new.site_id is null then
    select id into new.site_id from public.sites where client_id = new.client_id order by created_at limit 1;
  end if;
  return new;
end $$;
drop trigger if exists screens_default_location on public.screens;
create trigger screens_default_location before insert or update of client_id, site_id on public.screens
  for each row execute function public.screens_default_location();

-- 4b. trial sign-up: its location now comes from step 1 (named after the business), so it no longer adds one itself
do $m$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.create_my_business(text, text, text)'::regprocedure);
  d2 := replace(d, '  insert into public.sites (client_id, name) values (cid, site);', '  -- location added automatically, named after the business (036)');
  if d2 <> d then execute d2; end if;
end $m$;

-- 5. backfill
insert into public.sites (client_id, name)
  select c.id, coalesce(nullif(trim(c.name), ''), 'Main') from public.clients c
   where not exists (select 1 from public.sites s where s.client_id = c.id);
update public.screens sc set site_id = (select id from public.sites s where s.client_id = sc.client_id order by created_at limit 1)
 where sc.client_id is not null and sc.site_id is null;

notify pgrst, 'reload schema';
