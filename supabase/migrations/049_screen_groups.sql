-- 049: TV sub-categories on the Screens page (owner request 12 Nov 2026: "allow to create sub categories on this page").
-- A business's TVs can be put in named sub-categories (e.g. "E10", "E12 Gym", "Cafe"). The Screens page shows each
-- sub-category as its own heading inside the location; TVs not in one are listed under "Other TVs".
-- Like "Sort TVs" (048): Owner / Admins and the Proview master make and change them; everyone in the business sees them.

create table if not exists public.screen_groups (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists screen_groups_client_name on public.screen_groups (client_id, lower(btrim(name)));
alter table public.screen_groups enable row level security;
drop policy if exists screen_groups_select on public.screen_groups;
create policy screen_groups_select on public.screen_groups for select to authenticated
  using (public.is_admin() or public.is_member(client_id));
-- No direct writes: only the functions below.
revoke insert, update, delete on public.screen_groups from anon, authenticated;
grant select on public.screen_groups to authenticated;

alter table public.screens add column if not exists group_id uuid references public.screen_groups(id) on delete set null;

-- Create or rename a sub-category. p_id null = new. Returns its id.
create or replace function public.save_screen_group(p_client uuid, p_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare n text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')); gid uuid;
begin
  if not public.is_real_user() or not public.is_member(p_client, array['manager']) then
    raise exception 'Only an Owner / Admin can change sub-categories.';
  end if;
  if n = '' then raise exception 'Enter a name for the sub-category.'; end if;
  if length(n) > 60 then raise exception 'Keep the name under 60 characters.'; end if;
  if exists (select 1 from public.screen_groups where client_id = p_client and lower(name) = lower(n) and id is distinct from p_id) then
    raise exception 'There is already a sub-category called "%".', n;
  end if;
  if p_id is null then
    insert into public.screen_groups (client_id, name, sort_order)
      values (p_client, n, coalesce((select max(sort_order) + 1 from public.screen_groups where client_id = p_client), 0))
      returning id into gid;
  else
    update public.screen_groups set name = n where id = p_id and client_id = p_client returning id into gid;
    if gid is null then raise exception 'Sub-category not found.'; end if;
  end if;
  return gid;
end $$;

-- Delete a sub-category. Its TVs stay, under "Other TVs".
create or replace function public.delete_screen_group(p_client uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_real_user() or not public.is_member(p_client, array['manager']) then
    raise exception 'Only an Owner / Admin can change sub-categories.';
  end if;
  update public.screens set group_id = null where client_id = p_client and group_id = p_id;
  delete from public.screen_groups where id = p_id and client_id = p_client;
end $$;

-- Order of the sub-categories: p_ids first to last.
create or replace function public.set_screen_group_order(p_client uuid, p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_real_user() or not public.is_member(p_client, array['manager']) then
    raise exception 'Only an Owner / Admin can change sub-categories.';
  end if;
  update public.screen_groups g set sort_order = o.pos
    from unnest(p_ids) with ordinality as o(id, pos)
   where g.id = o.id and g.client_id = p_client;
end $$;

-- Put TVs in a sub-category (p_group null = take them out of any).
create or replace function public.set_screens_group(p_client uuid, p_screen_ids uuid[], p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_real_user() or not public.is_member(p_client, array['manager']) then
    raise exception 'Only an Owner / Admin can change sub-categories.';
  end if;
  if p_group is not null and not exists (select 1 from public.screen_groups where id = p_group and client_id = p_client) then
    raise exception 'Sub-category not found.';
  end if;
  update public.screens set group_id = p_group where client_id = p_client and id = any(p_screen_ids);
end $$;

revoke all on function public.save_screen_group(uuid, uuid, text), public.delete_screen_group(uuid, uuid),
  public.set_screen_group_order(uuid, uuid[]), public.set_screens_group(uuid, uuid[], uuid) from public, anon;
grant execute on function public.save_screen_group(uuid, uuid, text), public.delete_screen_group(uuid, uuid),
  public.set_screen_group_order(uuid, uuid[]), public.set_screens_group(uuid, uuid[], uuid) to authenticated;

-- Nobody else changes a TV's sub-category by editing the TV directly.
create or replace function public.screens_group_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.group_id is distinct from old.group_id
     and current_user not in ('postgres', 'supabase_admin', 'service_role')
     and not public.is_member(new.client_id, array['manager']) then
    new.group_id := old.group_id;
  end if;
  -- A TV moved to another business leaves its sub-category.
  if new.client_id is distinct from old.client_id then new.group_id := null; end if;
  return new;
end $$;
drop trigger if exists screens_group_guard on public.screens;
create trigger screens_group_guard before update on public.screens
  for each row execute function public.screens_group_guard();

notify pgrst, 'reload schema';
