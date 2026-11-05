-- 021: self sign-up from the website, with a one-screen free trial.
--  • create_my_business(): a signed-up user with no business yet creates one and becomes its manager.
--  • Businesses created this way are marked self_signup. Until one of their TVs has a paid licence,
--    they can pair only 1 TV (the 7-day trial). Businesses added by an admin are not limited.
--  • Admins get a notification for every new sign-up.

alter table public.clients add column if not exists self_signup boolean not null default false;

-- Does this business have at least one TV on a paid (non-trial), current licence?
create or replace function public.client_has_paid_licence(p_client uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.screens
     where client_id = p_client
       and license_type is not null and license_type <> 'trial7'
       and (license_type = 'lifetime' or license_expires_at > now()));
$$;
revoke all on function public.client_has_paid_licence(uuid) from public, anon, authenticated;

create or replace function public.create_my_business(p_name text, p_phone text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  nm text := left(trim(coalesce(p_name, '')), 80);
  em text := auth.jwt() ->> 'email';
begin
  if not public.is_real_user() then raise exception 'Please sign in first.'; end if;
  if length(nm) < 2 then raise exception 'Please enter your business name.'; end if;
  if exists (select 1 from public.client_members where user_id = auth.uid()) then
    raise exception 'Your account already belongs to a business.';
  end if;
  insert into public.clients (name, contact_email, self_signup, notes)
  values (nm, em, true, nullif('Signed up online' || coalesce(' · phone ' || nullif(left(trim(p_phone), 30), ''), ''), ''))
  returning id into cid;
  insert into public.client_members (client_id, user_id, role) values (cid, auth.uid(), 'manager');
  -- tell the admins (client_id null = admins only)
  insert into public.notifications (client_id, kind, title, body)
  values (null, 'signup', 'New sign-up: ' || nm,
          coalesce(em, 'unknown email') || coalesce(' · ' || nullif(left(trim(p_phone), 30), ''), '') || ' started a free trial.');
  return cid;
end;
$$;
revoke all on function public.create_my_business(text, text) from public, anon;
grant execute on function public.create_my_business(text, text) to authenticated;

-- Pairing: same as before (003), plus the one-TV limit for self sign-up businesses still on trial.
create or replace function public.claim_screen(p_code text, p_name text default null, p_client uuid default null)
returns public.screens language plpgsql security definer set search_path = public as $$
declare
  s public.screens;
  give_trial boolean := false;
  reason text := null;
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

  if s.license_type is null then
    if s.hardware_id is null then
      reason := 'no device ID: use the PROVIEW SIGNAGE TV app, or ask Proview for a licence';
    elsif exists (select 1 from public.trial_devices where hardware_id = s.hardware_id) then
      reason := 'this device has already used its free trial';
    else
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
         license_expires_at = case when give_trial then now() + interval '7 days' else license_expires_at end,
         license_updated_at = case when give_trial then now() else license_updated_at end,
         trial_blocked_reason = case when license_type is null and not give_trial then reason else trial_blocked_reason end
   where id = s.id
  returning * into s;
  return s;
end;
$$;
revoke all on function public.claim_screen(text, text, uuid) from public, anon;
grant execute on function public.claim_screen(text, text, uuid) to authenticated;

-- whoami also says whether the business signed up online (the dashboard shows the trial limit)
create or replace function public.whoami()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id',  auth.uid(),
    'email',    auth.jwt() ->> 'email',
    'is_admin', public.is_admin(),
    'clients',  coalesce((
       select jsonb_agg(jsonb_build_object(
                'id', c.id, 'name', c.name, 'contact_email', c.contact_email, 'require_approval', c.require_approval,
                'self_signup', c.self_signup, 'trial_only', c.self_signup and not public.client_has_paid_licence(c.id),
                'role', case when public.is_admin() then coalesce(m.role, 'admin') else m.role end)
              order by lower(c.name))
         from public.clients c
         left join public.client_members m on m.client_id = c.id and m.user_id = auth.uid()
        where public.is_admin() or m.user_id is not null), '[]'::jsonb)
  );
$$;
