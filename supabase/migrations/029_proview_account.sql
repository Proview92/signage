-- "Sign in with Proview account": one-time assertion log (used only by the sso-login edge function).
create table if not exists public.sso_used (
  jti   text primary key,
  email text,
  at    timestamptz not null default now()
);
alter table public.sso_used enable row level security;
revoke all on public.sso_used from public, anon, authenticated;
grant all on public.sso_used to service_role;
-- Who may sign in to Signage with their Proview account: admins and client managers.
-- Editors keep their own login; invites are still accepted through the invite link.
create or replace function public.sso_entitled(p_email text) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare uid uuid; em text := lower(trim(p_email));
begin
  select id into uid from auth.users where lower(email) = em order by created_at limit 1;
  if uid is null then
    return jsonb_build_object('ok', false, 'reason', 'No Proview Signage account for this email.');
  end if;
  if exists (select 1 from public.profiles where id = uid and is_admin)
     or exists (select 1 from public.client_members where user_id = uid and role = 'manager') then
    return jsonb_build_object('ok', true, 'user_id', uid);
  end if;
  if exists (select 1 from public.client_members where user_id = uid) then
    return jsonb_build_object('ok', false, 'reason', 'This is an editor login in Signage. Sign in there with your Signage email and password.');
  end if;
  return jsonb_build_object('ok', false, 'reason', 'This Signage login isn’t linked to a business yet. Sign in there with your Signage password.');
end $$;
revoke all on function public.sso_entitled(text) from public, anon, authenticated;
grant execute on function public.sso_entitled(text) to service_role;
