-- 042: no free trials (NO_TRIAL_SPEC, owner 11 Nov 2026: "make all businesses start with inactive, they must purchase a
-- license" / "No trials at all").
--
-- Signage licences are per TV. A new business, and its location, start with no licence: every TV paired to it shows the
-- TV app's existing "no licence" screen until a licence is bought (Buy licence online on the TV page, Stripe links from
-- the licence hub's hub_plans, or the licence portal / 020 8935 5495).
--
-- Trial paths closed here:
--   create_my_business  (self-signup "Set up your business")  no longer sets clients.trial_ends_at (was now() + 3 days)
--                        and no longer refuses an email that already had a trial (trial_signups is only a record now).
--   claim_screen         no longer gives a newly paired TV a 3-day 'trial7' licence (trial_devices is only a record now),
--                        except a business that is on its business trial today (it keeps its current expiry), and the
--                        "1 screen on the free trial" limit applies only to those businesses.
--   clients insert       (add_business, hub_call 'add_business' (041, if applied), any direct insert): a new trigger
--                        clears trial_ends_at, so no path can create a business on a trial.
--   whoami               trial_only is true only for a business that really has a trial end date; new 'has_licence'.
-- Existing businesses and TVs are not changed: trial_ends_at and screens' licences already set stay as they are.
-- trial7 can still be set by hand from the licence portal (hub_call 'set'), as before.
-- Safe to run more than once.

-- 1) Any new business starts without a trial.
create or replace function public.clients_no_trial()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.trial_ends_at := null;
  return new;
end $$;

drop trigger if exists clients_no_trial on public.clients;
create trigger clients_no_trial before insert on public.clients
  for each row execute function public.clients_no_trial();

-- 2) Self-signup: creates the business (and, through clients_one_location, its location), no licence, you as Owner.
create or replace function public.create_my_business(p_name text, p_phone text default null, p_site text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
  nm text := left(trim(coalesce(p_name, '')), 80);
  site text := left(trim(coalesce(p_site, '')), 80);
  ph text := nullif(left(trim(coalesce(p_phone, '')), 30), '');
  em text;
begin
  if not public.is_real_user() then raise exception 'Please sign in first.'; end if;
  if public.is_admin() then raise exception 'The Proview master account can''t set up a business here. Add businesses from the Locations page.'; end if;
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

  insert into public.clients (name, contact_email, self_signup, notes)
  values (nm, em, true, 'Signed up online' || coalesce(' · phone ' || ph, ''))
  returning id into cid;

  -- kept only as a record of who signed up (no longer limits anything)
  insert into public.trial_signups (email, client_id, user_id) values (em, cid, auth.uid())
  on conflict (email) do nothing;

  -- location added automatically, named after the business (036)
  insert into public.client_members (client_id, user_id, role) values (cid, auth.uid(), 'manager');
  insert into public.notifications (client_id, kind, title, body)
  values (null, 'signup', 'New sign-up: ' || nm,
          em || coalesce(' · ' || ph, '') || ' set up a business online. No licence yet: it needs a licence for each TV.');
  return cid;
end;
$$;

-- 3) Pairing a TV: no free trial licence any more.
create or replace function public.claim_screen(p_code text, p_name text default null, p_client uuid default null)
returns public.screens
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.screens;
  give_trial boolean := false;
  reason text := null;
  biz_end timestamptz := null;
begin
  if not public.is_real_user() then raise exception 'sign in to pair a screen'; end if;
  if p_client is null and not public.is_admin() then raise exception 'Choose a business for this TV.'; end if;
  if p_client is not null and not public.is_member(p_client, array['manager']) then
    raise exception 'only managers can add screens';
  end if;

  if p_client is not null then
    select trial_ends_at into biz_end from public.clients where id = p_client;
  end if;

  -- only businesses that were given a business trial before 042 (unchanged for them)
  if p_client is not null and not public.is_admin() and biz_end is not null
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

  if s.license_type is null then
    if biz_end is null then
      reason := null;   -- no trials: the TV needs a licence
    elsif biz_end <= now() then
      reason := 'the free trial for this business has ended';
    elsif s.hardware_id is null then
      reason := 'no device ID: use the PROVIEW SIGNAGE TV app, or ask Proview for a licence';
    elsif exists (select 1 from public.trial_devices where hardware_id = s.hardware_id) then
      reason := 'this device has already used its free trial';
    else
      -- a business trial that is still running (from before 042): the TV gets the rest of it, as before
      give_trial := true;
      insert into public.trial_devices (hardware_id, screen_id) values (s.hardware_id, s.id)
      on conflict (hardware_id) do nothing;
    end if;
  end if;

  update public.screens
     set claimed = true, client_id = p_client, pairing_code = null,
         name = coalesce(nullif(trim(p_name), ''), name),
         license_type       = case when give_trial then 'trial7' else license_type end,
         license_starts_at  = case when give_trial then now() else license_starts_at end,
         license_expires_at = case when give_trial then least(now() + interval '3 days', biz_end) else license_expires_at end,
         license_updated_at = case when give_trial then now() else license_updated_at end,
         trial_blocked_reason = case when license_type is null and not give_trial then reason else trial_blocked_reason end
   where id = s.id
  returning * into s;
  return s;
end;
$$;

-- 4) whoami: trial_only only for a business with a real trial end date; has_licence = any TV has a licence (any state).
create or replace function public.whoami()
returns jsonb
language sql
stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'user_id',  auth.uid(),
    'email',    auth.jwt() ->> 'email',
    'is_admin', public.is_admin(),
    'clients',  coalesce((
       select jsonb_agg(jsonb_build_object(
                'id', c.id, 'name', c.name, 'contact_email', c.contact_email, 'require_approval', c.require_approval,
                'self_signup', c.self_signup,
                'trial_only', c.self_signup and c.trial_ends_at is not null and not public.client_has_paid_licence(c.id),
                'trial_ends_at', c.trial_ends_at,
                'has_licence', exists (select 1 from public.screens sc where sc.client_id = c.id and sc.license_type is not null),
                'role', case when public.is_admin() then coalesce(m.role, 'admin') else m.role end,
                'site_ids', case when public.is_admin() or m.role = 'manager' then null else to_jsonb(m.site_ids) end,
                'features', case when public.is_admin() or m.role = 'manager' then '{}'::jsonb else coalesce(m.features, '{}'::jsonb) end)
              order by lower(c.name))
         from public.clients c
         left join public.client_members m on m.client_id = c.id and m.user_id = auth.uid()
        where public.is_admin() or m.user_id is not null), '[]'::jsonb)
  );
$$;
