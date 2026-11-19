-- 054 (owner, 20 Nov 2026): the standard Proview roles and sign-in check, the same in every Proview app.
--   Roles of a business: admin, manager, staff (nothing else). The Proview master stays the master (profiles.is_admin).
--   Signage's old names move over with the same access:
--     manager      (Owner / Admin: whole business, manages users)  -> admin
--     site_manager (Manager: chosen locations / features, no approval) -> manager
--     editor       (Staff: chosen locations / features)                 -> staff
--   Every function and policy that knew the old names is rewritten in one pass (a placeholder keeps manager -> admin and
--   site_manager -> manager from colliding), plus the CHECKs and defaults on client_members and invites.
--   Sign-in check (sso_entitled), as Proview WiFi's rules, with account wording.
-- Safe to run more than once (a second run finds nothing to rename).

-- 1) drop the old role CHECKs first (they only allow the old names)
do $c$
declare r record; t text;
begin
  foreach t in array array['client_members', 'invites', 'client_members_off'] loop
    continue when to_regclass('public.' || t) is null;
    for r in select conname from pg_constraint where conrelid = ('public.' || t)::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ~ 'role' loop
      execute format('alter table public.%I drop constraint %I', t, r.conname);
    end loop;
  end loop;
end $c$;

-- 2) data (one statement per table, so the swap can't collide)
update public.client_members set role = case role when 'manager' then 'admin' when 'site_manager' then 'manager' when 'editor' then 'staff' else role end
 where role in ('manager', 'site_manager', 'editor') and not exists (select 1 from public.client_members x where x.role = 'admin' or x.role = 'staff');
update public.invites set role = case role when 'manager' then 'admin' when 'site_manager' then 'manager' when 'editor' then 'staff' else role end
 where role in ('manager', 'site_manager', 'editor') and not exists (select 1 from public.invites x where x.role = 'admin' or x.role = 'staff');
do $o$ begin
  if to_regclass('public.client_members_off') is not null and not exists (select 1 from public.client_members_off where role in ('admin', 'staff')) then
    update public.client_members_off set role = case role when 'manager' then 'admin' when 'site_manager' then 'manager' when 'editor' then 'staff' else role end
     where role in ('manager', 'site_manager', 'editor');
  end if;
end $o$;

-- 2b) only admin / manager / staff from now on (default staff)
do $c$
declare t text;
begin
  foreach t in array array['client_members', 'invites', 'client_members_off'] loop
    continue when to_regclass('public.' || t) is null;
    execute format('alter table public.%I add constraint %I check (role in (''admin'', ''manager'', ''staff''))', t, t || '_role_check');
    execute format('alter table public.%I alter column role set default ''staff''', t);
  end loop;
end $c$;

-- 3) policies that knew the old names
do $p$
declare r record; q text; w text;
begin
  for r in select * from pg_policies where schemaname = 'public'
            and coalesce(qual, '') || coalesce(with_check, '') ~ '''(manager|site_manager|editor)''' loop
    q := r.qual; w := r.with_check;
    q := replace(replace(replace(replace(q, '''site_manager''', '''@@SM@@'''), '''manager''', '''admin'''), '''@@SM@@''', '''manager'''), '''editor''', '''staff''');
    w := replace(replace(replace(replace(w, '''site_manager''', '''@@SM@@'''), '''manager''', '''admin'''), '''@@SM@@''', '''manager'''), '''editor''', '''staff''');
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    execute format('create policy %I on %I.%I as %s for %s to %s', r.policyname, r.schemaname, r.tablename, r.permissive, r.cmd,
                   array_to_string(r.roles, ', '))
            || case when q is not null then format(' using (%s)', q) else '' end
            || case when w is not null then format(' with check (%s)', w) else '' end;
  end loop;
end $p$;

-- 4) functions: every role name in one pass, texts reworded
do $f$
declare r record; d text; n text;
begin
  for r in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname in ('public', 'hub_private') and p.prokind = 'f' and p.proname <> 'sso_entitled'
              and p.prosrc ~ '''(manager|site_manager|editor)''|"(manager|site_manager|editor)"' loop
    d := pg_get_functiondef(r.oid); n := d;
    -- the role list the licence portal shows, and the link ranking
    n := replace(n, '[{"value": "manager", "label": "Owner / Admin"}, {"value": "site_manager", "label": "Location manager"}, {"value": "editor", "label": "Editor"}]',
                    '[{"value": "admin", "label": "Admin"}, {"value": "manager", "label": "Manager"}, {"value": "staff", "label": "Staff"}]');
    n := replace(n, '{"manager":3,"site_manager":2,"editor":1}', '{"admin":3,"manager":2,"staff":1}');
    -- the invite email's wording of the role
    n := replace(n, 'when i.role = ''manager'' then ''owner / admin'' when i.role = ''site_manager'' then ''manager'' else ''staff'' end',
                    'when i.role = ''@@A@@'' then ''admin'' when i.role = ''@@M@@'' then ''@@TM@@'' else ''staff'' end');
    -- messages
    n := replace(n, 'Only owners and admins can send invites.', 'Only admins can send invites.');
    n := replace(n, 'Only managers can send invites.', 'Only admins can send invites.');
    n := replace(n, 'Only managers can approve.', 'Only admins can approve.');
    n := replace(n, 'Only managers can change this.', 'Only admins can change this.');
    -- the role names (placeholder first so manager -> admin and site_manager -> manager don't collide)
    n := replace(n, '''site_manager''', '''@@M@@''');
    n := replace(n, '''manager''', '''@@A@@''');
    n := replace(n, '''editor''', '''staff''');
    n := replace(n, '''@@A@@''', '''admin''');
    n := replace(n, '''@@M@@''', '''manager''');
    n := replace(n, '''@@TM@@''', '''manager''');
    if n <> d then execute n; end if;
  end loop;
end $f$;

-- 5) the standard sign-in check (a member is always a login in Signage, so there is nothing to create here)
create or replace function public.sso_entitled(p_email text) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare uid uuid; ban timestamptz; em text := lower(trim(p_email));
begin
  select id, banned_until into uid, ban from auth.users
   where lower(email) = em and not coalesce(is_anonymous, false) order by created_at limit 1;
  if ban > now() then return jsonb_build_object('ok', false, 'reason', 'This Proview Signage account is on hold. Contact Proview.'); end if;
  if uid is not null and (exists (select 1 from public.profiles where id = uid and is_admin)
                          or exists (select 1 from public.client_members where user_id = uid)) then
    return jsonb_build_object('ok', true, 'user_id', uid);
  end if;
  if uid is not null and to_regclass('public.client_members_off') is not null
     and exists (select 1 from public.client_members_off where user_id = uid) then
    return jsonb_build_object('ok', false, 'reason', 'This Proview Signage account is switched off. Ask your business admin.');
  end if;
  return jsonb_build_object('ok', false, 'reason', 'No Proview Signage account for this email.');
end $$;
revoke execute on function public.sso_entitled(text) from public, anon, authenticated;
grant execute on function public.sso_entitled(text) to service_role;
