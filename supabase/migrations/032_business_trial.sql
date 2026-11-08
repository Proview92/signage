-- =====================================================================
--  032: 3-day business trial on self sign-up (TRIAL_SPEC, 8 Nov 2026)
--  - create_my_business(name, phone, site): creates the business, its first
--    site and makes the caller its Owner ('manager'). The business gets
--    clients.trial_ends_at = now() + 3 days.
--  - One trial per email, enforced here (trial_signups keeps the email even
--    if the business is later deleted).
--  - Never for the master, people who already belong to a business, or
--    people with a pending invite (join_my_invites() joins those instead).
--  - Per-TV licences stay the source of truth for playback: a TV paired
--    while the business trial runs gets the usual 'trial7' licence (same
--    once-per-device rule), but it ends WITH the business trial, not
--    3 days after pairing. After the business trial no automatic TV trial.
--  - Admin-created businesses (trial_ends_at null) behave as before.
--  Safe to re-run.
-- =====================================================================

alter table public.clients add column if not exists trial_ends_at timestamptz;

create table if not exists public.trial_signups (
  email      text primary key,               -- lower(trim(email))
  client_id  uuid references public.clients(id) on delete set null,
  user_id    uuid,
  used_at    timestamptz not null default now()
);
alter table public.trial_signups enable row level security;
drop policy if exists trial_signups_admin on public.trial_signups;
create policy trial_signups_admin on public.trial_signups for select to authenticated
  using (public.is_admin());

-- Earlier online sign-ups count as having used their trial.
insert into public.trial_signups (email, client_id, used_at)
select lower(trim(contact_email)), id, created_at from public.clients
 where self_signup and contact_email is not null and trim(contact_email) <> ''
on conflict (email) do nothing;

-- Pending invites for the signed-in person's (confirmed) email: join them.
create or replace function public.join_my_invites() returns int
language plpgsql security definer set search_path = public as $$
declare
  em text;
  i public.invites;
  n int := 0;
begin
  if not public.is_real_user() then return 0; end if;
  select lower(u.email) into em from auth.users u
   where u.id = auth.uid() and u.email_confirmed_at is not null;
  if em is null then return 0; end if;
  for i in select * from public.invites where accepted_at is null and lower(email) = em order by created_at loop
    insert into public.client_members (client_id, user_id, role, site_ids, features)
    values (i.client_id, auth.uid(), i.role, i.site_ids, coalesce(i.features, '{}'::jsonb))
    on conflict (client_id, user_id) do nothing;
    update public.invites set accepted_at = now(), accepted_by = auth.uid() where id = i.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.join_my_invites() from public, anon;
grant execute on function public.join_my_invites() to authenticated;

drop function if exists public.create_my_business(text, text);
create or replace function public.create_my_business(p_name text, p_phone text default null, p_site text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  nm text := left(trim(coalesce(p_name, '')), 80);
  site text := left(trim(coalesce(p_site, '')), 80);
  ph text := nullif(left(trim(coalesce(p_phone, '')), 30), '');
  em text;
begin
  if not public.is_real_user() then raise exception 'Please sign in first.'; end if;
  if public.is_admin() then raise exception 'The Proview master account can''t start a trial. Add clients from All sites.'; end if;
  select lower(trim(u.email)) into em from auth.users u where u.id = auth.uid();
  if em is null or em = '' then raise exception 'Your account has no email address.'; end if;
  if length(nm) < 2 then raise exception 'Please enter your business name.'; end if;
  if site = '' then site := nm; end if;
  if exists (select 1 from public.client_members where user_id = auth.uid()) then
    raise exception 'Your account already belongs to a business.';
  end if;
  if exists (select 1 from public.invites where accepted_at is null and lower(email) = em) then
    raise exception 'You have been invited to a business. Open the invite link from your email to join it.';
  end if;

  insert into public.clients (name, contact_email, self_signup, trial_ends_at, notes)
  values (nm, em, true, now() + interval '3 days',
          'Signed up online' || coalesce(' · phone ' || ph, ''))
  returning id into cid;

  -- one trial per email (the primary key also stops two at once)
  insert into public.trial_signups (email, client_id, user_id) values (em, cid, auth.uid())
  on conflict (email) do nothing;
  if not found then
    raise exception 'A free trial has already been used with this email. Buy a licence at license.proviewcrm.co.uk or call Proview on 020 8935 5495.';
  end if;

  insert into public.sites (client_id, name) values (cid, site);
  insert into public.client_members (client_id, user_id, role) values (cid, auth.uid(), 'manager');
  insert into public.notifications (client_id, kind, title, body)
  values (null, 'signup', 'New sign-up: ' || nm,
          em || coalesce(' · ' || ph, '') || ' started a free 3-day trial (ends '
             || to_char((now() + interval '3 days') at time zone 'Europe/London', 'DD Mon HH24:MI') || ').');
  return cid;
end;
$$;
revoke all on function public.create_my_business(text, text, text) from public, anon;
grant execute on function public.create_my_business(text, text, text) to authenticated;

-- Pairing: as 022, but a TV in a business on its trial gets a trial that ends with the business trial.
create or replace function public.claim_screen(p_code text, p_name text default null, p_client uuid default null)
returns public.screens language plpgsql security definer set search_path = public as $$
declare
  s public.screens;
  give_trial boolean := false;
  reason text := null;
  biz_end timestamptz := null;
  trial_end timestamptz := now() + interval '3 days';
begin
  if not public.is_real_user() then raise exception 'sign in to pair a screen'; end if;
  if p_client is null and not public.is_admin() then raise exception 'choose a client'; end if;
  if p_client is not null and not public.is_member(p_client, array['manager']) then
    raise exception 'only managers can add screens';
  end if;

  if p_client is not null and not public.is_admin()
     and exists (select 1 from public.clients where id = p_client and self_signup)
     and not public.client_has_paid_licence(p_client)
     and (select count(*) from public.screens where client_id = p_client and claimed) >= 1 then
    raise exception 'Your free trial includes 1 screen. Buy a licence for your first TV to add more, or call us on 020 8935 5495.';
  end if;

  select * into s from public.screens
   where pairing_code = upper(replace(trim(p_code), ' ', '')) and not claimed
   for update;
  if not found then
    raise exception 'No screen is showing that code. Check the code on the TV and try again.';
  end if;

  if p_client is not null then
    select trial_ends_at into biz_end from public.clients where id = p_client;
  end if;

  if s.license_type is null then
    if biz_end is not null and biz_end <= now() then
      reason := 'the free trial for this business has ended';
    elsif s.hardware_id is null then
      reason := 'no device ID: use the PROVIEW SIGNAGE TV app, or ask Proview for a licence';
    elsif exists (select 1 from public.trial_devices where hardware_id = s.hardware_id) then
      reason := 'this device has already used its free trial';
    else
      give_trial := true;
      if biz_end is not null then trial_end := least(trial_end, biz_end); end if;
      insert into public.trial_devices (hardware_id, screen_id) values (s.hardware_id, s.id)
      on conflict (hardware_id) do nothing;
    end if;
  end if;

  update public.screens
     set claimed = true, client_id = p_client, pairing_code = null,
         name = coalesce(nullif(trim(p_name), ''), name),
         license_type       = case when give_trial then 'trial7' else license_type end,
         license_starts_at  = case when give_trial then now() else license_starts_at end,
         license_expires_at = case when give_trial then trial_end else license_expires_at end,
         license_updated_at = case when give_trial then now() else license_updated_at end,
         trial_blocked_reason = case when license_type is null and not give_trial then reason else trial_blocked_reason end
   where id = s.id
  returning * into s;
  return s;
end;
$$;
revoke all on function public.claim_screen(text, text, uuid) from public, anon;
grant execute on function public.claim_screen(text, text, uuid) to authenticated;

-- whoami: as 030, plus trial_ends_at (the dashboard and All sites show the trial status)
create or replace function public.whoami() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id',  auth.uid(),
    'email',    auth.jwt() ->> 'email',
    'is_admin', public.is_admin(),
    'clients',  coalesce((
       select jsonb_agg(jsonb_build_object(
                'id', c.id, 'name', c.name, 'contact_email', c.contact_email, 'require_approval', c.require_approval,
                'self_signup', c.self_signup, 'trial_only', c.self_signup and not public.client_has_paid_licence(c.id),
                'trial_ends_at', c.trial_ends_at,
                'role', case when public.is_admin() then coalesce(m.role, 'admin') else m.role end,
                'site_ids', case when public.is_admin() or m.role = 'manager' then null else to_jsonb(m.site_ids) end,
                'features', case when public.is_admin() or m.role = 'manager' then '{}'::jsonb else coalesce(m.features, '{}'::jsonb) end)
              order by lower(c.name))
         from public.clients c
         left join public.client_members m on m.client_id = c.id and m.user_id = auth.uid()
        where public.is_admin() or m.user_id is not null), '[]'::jsonb)
  );
$$;
