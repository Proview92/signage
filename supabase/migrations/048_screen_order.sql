-- 048: Owner / Admins and the Proview master can put a business's TVs in their own order.
-- TVs with no order yet come after the ordered ones, by name (as before).

alter table public.screens add column if not exists sort_order integer;

-- Save the order: p_ids is every TV of the business, first to last.
create or replace function public.set_screen_order(p_client uuid, p_ids uuid[])
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_real_user() or not public.is_member(p_client, array['manager']) then
    raise exception 'Only an Owner / Admin can change the TV order.';
  end if;
  update public.screens s
     set sort_order = o.pos
    from unnest(p_ids) with ordinality as o(id, pos)
   where s.id = o.id and s.client_id = p_client;
end;
$$;
revoke all on function public.set_screen_order(uuid, uuid[]) from public, anon;
grant execute on function public.set_screen_order(uuid, uuid[]) to authenticated;

-- Nobody else changes the order by editing a TV directly.
create or replace function public.screens_sort_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.sort_order is distinct from old.sort_order
     and current_user not in ('postgres', 'supabase_admin', 'service_role')
     and not public.is_member(new.client_id, array['manager']) then
    new.sort_order := old.sort_order;
  end if;
  return new;
end;
$$;
drop trigger if exists screens_sort_guard on public.screens;
create trigger screens_sort_guard before update on public.screens
  for each row execute function public.screens_sort_guard();

notify pgrst, 'reload schema';
