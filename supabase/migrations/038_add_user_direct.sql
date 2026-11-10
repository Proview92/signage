-- 038: "Add user" on the Users page. An Owner / Admin (or the Proview admin) creates a
-- ready-to-use login for someone: no invite email, they just sign in with the email and
-- password chosen here. Also keeps each person's name and mobile number.

alter table public.profiles
  add column if not exists full_name text,
  add column if not exists mobile    text;

create or replace function public.add_user(
  p_client uuid, p_name text, p_email text, p_mobile text, p_password text,
  p_role text, p_site_ids uuid[] default null, p_features jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  em   text := lower(trim(coalesce(p_email, '')));
  nm   text := nullif(trim(coalesce(p_name, '')), '');
  mob  text := nullif(trim(coalesce(p_mobile, '')), '');
  uid  uuid;
  existing boolean := false;
begin
  if not public.is_real_user() or not public.is_member(p_client, array['manager']) then
    raise exception 'Only an Owner / Admin can add users.';
  end if;
  if nm is null then raise exception 'Enter the person''s name.'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address.'; end if;
  if p_role not in ('manager', 'site_manager', 'editor') then raise exception 'Choose a role.'; end if;
  if p_role = 'manager' then p_site_ids := null; p_features := '{}'::jsonb; end if;
  if p_site_ids is not null and exists (
       select 1 from unnest(p_site_ids) x where x not in (select id from public.sites where client_id = p_client)) then
    raise exception 'One of those locations belongs to a different business.';
  end if;

  select id into uid from auth.users where lower(email) = em and not coalesce(is_anonymous, false) limit 1;
  if uid is not null then
    -- Already has a login: add them to this business, but never touch their password.
    existing := true;
    if exists (select 1 from public.client_members where client_id = p_client and user_id = uid) then
      raise exception 'That person is already a user of this business.';
    end if;
  else
    if length(coalesce(p_password, '')) < 6 then raise exception 'The password needs at least 6 characters.'; end if;
    uid := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, email_change_token_new)
    values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', em,
            extensions.crypt(p_password, extensions.gen_salt('bf', 10)), now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_strip_nulls(jsonb_build_object('full_name', nm, 'mobile', mob)), now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text, 'email',
            jsonb_build_object('sub', uid::text, 'email', em, 'email_verified', true, 'phone_verified', false), now(), now(), now());
  end if;

  insert into public.profiles (id, email) values (uid, em) on conflict (id) do nothing;
  update public.profiles
     set full_name = case when existing then coalesce(full_name, nm) else nm end,
         mobile    = case when existing then coalesce(mobile, mob)   else mob end
   where id = uid;

  insert into public.client_members (client_id, user_id, role, site_ids, features)
  values (p_client, uid, p_role, p_site_ids, coalesce(p_features, '{}'::jsonb));

  delete from public.invites where client_id = p_client and lower(email) = em and accepted_at is null;
  return jsonb_build_object('user_id', uid, 'email', em, 'existing', existing);
end;
$$;
revoke all on function public.add_user(uuid, text, text, text, text, text, uuid[], jsonb) from public, anon;
grant execute on function public.add_user(uuid, text, text, text, text, text, uuid[], jsonb) to authenticated;

-- Users list now also gives the name and mobile.
drop function if exists public.list_team(uuid);
create function public.list_team(p_client uuid)
returns table(user_id uuid, email text, role text, created_at timestamptz, site_ids uuid[], features jsonb, full_name text, mobile text)
language sql stable security definer
set search_path = public
as $$
  select m.user_id, coalesce(p.email, u.email)::text, m.role, m.created_at, m.site_ids, m.features, p.full_name, p.mobile
    from public.client_members m
    left join public.profiles p on p.id = m.user_id
    left join auth.users u on u.id = m.user_id
   where m.client_id = p_client and public.is_member(p_client)
   order by m.created_at;
$$;
revoke all on function public.list_team(uuid) from public, anon;
grant execute on function public.list_team(uuid) to authenticated;

-- Owner / Admin (and the Proview admin) can edit a user's name and mobile...
create or replace function public.update_user_details(p_client uuid, p_user uuid, p_name text, p_mobile text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_real_user() or not public.is_member(p_client, array['manager']) then
    raise exception 'Only an Owner / Admin can edit users.';
  end if;
  if not exists (select 1 from public.client_members where client_id = p_client and user_id = p_user) then
    raise exception 'That person is not a user of this business.';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'Enter the person''s name.'; end if;
  update public.profiles set full_name = trim(p_name), mobile = nullif(trim(coalesce(p_mobile, '')), '') where id = p_user;
end;
$$;
revoke all on function public.update_user_details(uuid, uuid, text, text) from public, anon;
grant execute on function public.update_user_details(uuid, uuid, text, text) to authenticated;

-- ...and type a new password for them. They are signed out everywhere and sign in with the new one.
-- An Owner / Admin can't do this to a Proview admin, or to someone who is also in a business they don't run.
create or replace function public.set_user_password(p_client uuid, p_user uuid, p_password text)
returns text
language plpgsql security definer
set search_path = public, extensions
as $$
declare em text;
begin
  if not public.is_real_user() or not public.is_member(p_client, array['manager']) then
    raise exception 'Only an Owner / Admin can change a user''s password.';
  end if;
  if p_user = auth.uid() then raise exception 'Change your own password from your account menu.'; end if;
  if not exists (select 1 from public.client_members where client_id = p_client and user_id = p_user) then
    raise exception 'That person is not a user of this business.';
  end if;
  if not public.is_admin() then
    if exists (select 1 from public.profiles where id = p_user and is_admin) then
      raise exception 'You can''t change this person''s password.';
    end if;
    if exists (select 1 from public.client_members m where m.user_id = p_user
                and not public.is_member(m.client_id, array['manager'])) then
      raise exception 'This person also belongs to another business, so you can''t type a password for them. Send them a reset link instead.';
    end if;
  end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'The password needs at least 6 characters.'; end if;

  -- the auth_clear_temp_password trigger clears any "must change password" flag
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'temp_password_expired',
         updated_at = now()
   where id = p_user and coalesce(is_anonymous, false) = false
  returning email into em;
  if em is null then raise exception 'user not found'; end if;
  delete from auth.sessions where user_id = p_user;
  return em;
end;
$$;
revoke all on function public.set_user_password(uuid, uuid, text) from public, anon;
grant execute on function public.set_user_password(uuid, uuid, text) to authenticated;
