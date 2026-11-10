-- 039: switch a user off (deactivate) and back on, per business.
-- A deactivated membership is MOVED to client_members_off, so every existing permission check
-- (is_member, can_site, has_feature, whoami, ...) treats the person as not in the business at all.
-- Switching them back on moves the row back with the same role, locations and features.

create table if not exists public.client_members_off (
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null,
  site_ids  uuid[],
  features  jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  deactivated_at timestamptz not null default now(),
  deactivated_by text,
  primary key (client_id, user_id)
);
alter table public.client_members_off enable row level security;   -- no policies: only the functions below touch it
revoke all on public.client_members_off from anon, authenticated;

create or replace function public.set_user_active(p_client uuid, p_user uuid, p_active boolean)
returns boolean
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_real_user() or not public.is_member(p_client, array['manager']) then
    raise exception 'Only an Owner / Admin can switch users on or off.';
  end if;
  if p_user = auth.uid() then raise exception 'You can''t deactivate your own account.'; end if;
  -- An Owner / Admin can only be switched off (or back on) by the Proview master account.
  if not public.is_admin() and (
       exists (select 1 from public.client_members     where client_id = p_client and user_id = p_user and role = 'manager')
    or exists (select 1 from public.client_members_off where client_id = p_client and user_id = p_user and role = 'manager')) then
    raise exception 'Only Proview can deactivate an Owner / Admin.';
  end if;

  if p_active then
    insert into public.client_members (client_id, user_id, role, site_ids, features, created_at)
    select client_id, user_id, role, site_ids, features, created_at
      from public.client_members_off where client_id = p_client and user_id = p_user
    on conflict do nothing;
    delete from public.client_members_off where client_id = p_client and user_id = p_user;
  else
    if not exists (select 1 from public.client_members where client_id = p_client and user_id = p_user) then
      raise exception 'That person is not an active user of this business.';
    end if;
    insert into public.client_members_off (client_id, user_id, role, site_ids, features, created_at, deactivated_by)
    select client_id, user_id, role, site_ids, features, created_at, auth.jwt() ->> 'email'
      from public.client_members where client_id = p_client and user_id = p_user
    on conflict (client_id, user_id) do update set role = excluded.role, site_ids = excluded.site_ids,
      features = excluded.features, deactivated_at = now(), deactivated_by = excluded.deactivated_by;
    delete from public.client_members where client_id = p_client and user_id = p_user;
  end if;
  return p_active;
end;
$$;
revoke all on function public.set_user_active(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_user_active(uuid, uuid, boolean) to authenticated;

-- Remove a deactivated user for good.
create or replace function public.remove_deactivated_user(p_client uuid, p_user uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_real_user() or not public.is_member(p_client, array['manager']) then
    raise exception 'Only an Owner / Admin can remove users.';
  end if;
  delete from public.client_members_off where client_id = p_client and user_id = p_user;
end;
$$;
revoke all on function public.remove_deactivated_user(uuid, uuid) from public, anon;
grant execute on function public.remove_deactivated_user(uuid, uuid) to authenticated;

-- For the sign-in screen: true when this person has been deactivated and has no active business left.
create or replace function public.am_i_deactivated()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.client_members_off where user_id = auth.uid())
     and not exists (select 1 from public.client_members where user_id = auth.uid());
$$;
revoke all on function public.am_i_deactivated() from public, anon;
grant execute on function public.am_i_deactivated() to authenticated;

-- Users list: active and deactivated people, with an "active" flag. Only Owner / Admins see the deactivated ones.
drop function if exists public.list_team(uuid);
create function public.list_team(p_client uuid)
returns table(user_id uuid, email text, role text, created_at timestamptz, site_ids uuid[], features jsonb, full_name text, mobile text, active boolean)
language sql stable security definer
set search_path = public
as $$
  select m.user_id, coalesce(p.email, u.email)::text, m.role, m.created_at, m.site_ids, m.features, p.full_name, p.mobile, m.active
    from (select client_id, user_id, role, created_at, site_ids, features, true as active from public.client_members
          union all
          select client_id, user_id, role, created_at, site_ids, features, false from public.client_members_off
           where public.is_member(p_client, array['manager'])) m
    left join public.profiles p on p.id = m.user_id
    left join auth.users u on u.id = m.user_id
   where m.client_id = p_client and public.is_member(p_client)
   order by m.created_at;
$$;
revoke all on function public.list_team(uuid) from public, anon;
grant execute on function public.list_team(uuid) to authenticated;

notify pgrst, 'reload schema';
