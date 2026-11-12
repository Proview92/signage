-- 052: the licence portal can pause / resume a business and delete it completely (owner, 12 Nov 2026).
--  * clients.suspended: a paused business is locked for its people (is_member is false for them, so nothing can be read
--    or changed; whoami still lists it with suspended so the app says "This business is paused") and its TVs stop
--    (screens.suspended, a copy kept by triggers: the player shows "Paused").
--  * hub_call 'suspend' { account_id, suspended } and 'delete_account' { account_id }: deletes the business, its TVs
--    (and their device sign-ins) and everything it holds (clients cascades). People's logins are kept.
alter table public.clients add column if not exists suspended boolean not null default false;
alter table public.screens add column if not exists suspended boolean not null default false;

create or replace function public.screens_suspended_copy() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.suspended := coalesce((select c.suspended from public.clients c where c.id = new.client_id), false);
  return new;
end $$;
drop trigger if exists screens_suspended_copy on public.screens;
create trigger screens_suspended_copy before insert or update of client_id, suspended on public.screens
  for each row execute function public.screens_suspended_copy();

create or replace function public.clients_suspended_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.screens set suspended = new.suspended where client_id = new.id;
  return null;
end $$;
drop trigger if exists clients_suspended_sync on public.clients;
create trigger clients_suspended_sync after update of suspended on public.clients
  for each row when (old.suspended is distinct from new.suspended) execute function public.clients_suspended_sync();

-- people of a paused business can't use it (the Proview master still can)
create or replace function public.is_member(p_client uuid, p_roles text[] default null::text[])
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (public.is_real_user()
          and not coalesce((select c.suspended from public.clients c where c.id = p_client), false)
          and exists (select 1 from public.client_members m
                       where m.client_id = p_client and m.user_id = auth.uid()
                         and (p_roles is null or m.role = any(p_roles))));
$$;

do $w$ declare d text; begin
  d := pg_get_functiondef('public.whoami()'::regprocedure);
  if position('''suspended'', c.suspended' in d) = 0 then
    execute replace(d, '''trial_ends_at'', c.trial_ends_at,', '''trial_ends_at'', c.trial_ends_at, ''suspended'', c.suspended,');
  end if;
end $w$;

create or replace function hub_private.sg_hub_admin(p_action text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.clients; s boolean; cid uuid; devs uuid[];
begin
  begin cid := (p_args->>'account_id')::uuid; exception when others then raise exception 'Business not found.'; end;
  select * into c from public.clients where id = cid;
  if p_action = 'suspend' then
    if c.id is null then raise exception 'Business not found.'; end if;
    s := coalesce((p_args->>'suspended')::boolean, true);
    update public.clients set suspended = s where id = c.id;
    return jsonb_build_object('ok', true, 'account_id', c.id, 'suspended', s);
  end if;
  if c.id is null then return jsonb_build_object('ok', true, 'account_id', cid, 'deleted', true, 'already', true); end if;
  select coalesce(array_agg(device_user_id) filter (where device_user_id is not null), '{}') into devs from public.screens where client_id = c.id;
  delete from public.screens where client_id = c.id;
  delete from public.clients where id = c.id;
  delete from auth.users where id = any(devs) and coalesce(is_anonymous, false);
  return jsonb_build_object('ok', true, 'account_id', c.id, 'deleted', true);
end $$;
revoke all on function hub_private.sg_hub_admin(text, jsonb) from public, anon, authenticated;

do $p$ declare d text; begin
  d := pg_get_functiondef('public.hub_call(text,text,jsonb)'::regprocedure);
  if position('sg_hub_admin' in d) = 0 then
    execute replace(d, '  if p_action is distinct from ''link'' and p_action is distinct from ''unlink'' then',
      '  if p_action in (''suspend'', ''delete_account'') then
    if p_token is null or encode(extensions.digest(p_token, ''sha256''), ''hex'') is distinct from (select token_sha256 from hub_private.config where id = 1) then
      raise exception ''not authorised'';
    end if;
    return hub_private.sg_hub_admin(p_action, p_args);
  end if;
  if p_action is distinct from ''link'' and p_action is distinct from ''unlink'' then');
  end if;
end $p$;
