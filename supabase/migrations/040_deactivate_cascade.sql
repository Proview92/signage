-- 040: when the Proview master account deactivates an Owner / Admin, the business's Managers and
-- Staff are deactivated with them. Switching that Owner / Admin back on restores exactly the people
-- that were switched off with them (anyone deactivated separately beforehand stays off).

alter table public.client_members_off add column if not exists cascade_from uuid;

create or replace function public.set_user_active(p_client uuid, p_user uuid, p_active boolean)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare is_owner boolean;
begin
  if not public.is_real_user() or not public.is_member(p_client, array['manager']) then
    raise exception 'Only an Owner / Admin can switch users on or off.';
  end if;
  if p_user = auth.uid() then raise exception 'You can''t deactivate your own account.'; end if;
  is_owner := exists (select 1 from public.client_members     where client_id = p_client and user_id = p_user and role = 'manager')
           or exists (select 1 from public.client_members_off where client_id = p_client and user_id = p_user and role = 'manager');
  -- An Owner / Admin can only be switched off (or back on) by the Proview master account.
  if is_owner and not public.is_admin() then
    raise exception 'Only Proview can deactivate an Owner / Admin.';
  end if;

  if p_active then
    insert into public.client_members (client_id, user_id, role, site_ids, features, created_at)
    select client_id, user_id, role, site_ids, features, created_at
      from public.client_members_off
     where client_id = p_client and (user_id = p_user or (is_owner and cascade_from = p_user))
    on conflict do nothing;
    delete from public.client_members_off
     where client_id = p_client and (user_id = p_user or (is_owner and cascade_from = p_user));
  else
    if not exists (select 1 from public.client_members where client_id = p_client and user_id = p_user) then
      raise exception 'That person is not an active user of this business.';
    end if;
    insert into public.client_members_off (client_id, user_id, role, site_ids, features, created_at, deactivated_by, cascade_from)
    select client_id, user_id, role, site_ids, features, created_at, auth.jwt() ->> 'email',
           case when user_id = p_user then null else p_user end
      from public.client_members
     where client_id = p_client and (user_id = p_user or (is_owner and role <> 'manager'))
    on conflict (client_id, user_id) do update set role = excluded.role, site_ids = excluded.site_ids,
      features = excluded.features, deactivated_at = now(), deactivated_by = excluded.deactivated_by,
      cascade_from = excluded.cascade_from;
    delete from public.client_members
     where client_id = p_client and (user_id = p_user or (is_owner and role <> 'manager'));
  end if;
  return p_active;
end;
$$;
