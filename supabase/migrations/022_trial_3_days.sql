-- =====================================================================
--  022: free trial is now 3 days (was 7)
--  - New TVs get a 3-day trial when first paired (once per device).
--  - Trials stop when they end: the 7-day grace period is for paid
--    licences only (keep in sync with web/js/license.js).
--  - TVs already on a trial keep the end date they were given.
--  The licence code stays 'trial7' so existing data keeps working.
--  Safe to re-run.
-- =====================================================================

create or replace function public.license_interval(p_type text)
returns interval language sql immutable as $$
  select case p_type
    when 'trial7' then interval '3 days'
    when 'm1'  then interval '1 month'
    when 'm3'  then interval '3 months'
    when 'm6'  then interval '6 months'
    when 'm12' then interval '12 months'
    when 'm24' then interval '24 months'
    when 'm36' then interval '36 months'
  end;
$$;

-- True while the TV may play: licensed and not past expiry (+ grace for paid licences).
create or replace function public.license_ok(p_type text, p_expires timestamptz)
returns boolean language sql stable as $$
  select p_type is not null
     and (p_type = 'lifetime' or p_expires is null
          or p_expires + case when p_type = 'trial7' then interval '0' else public.license_grace() end > now());
$$;

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
         license_expires_at = case when give_trial then now() + interval '3 days' else license_expires_at end,
         license_updated_at = case when give_trial then now() else license_updated_at end,
         trial_blocked_reason = case when license_type is null and not give_trial then reason else trial_blocked_reason end
   where id = s.id
  returning * into s;
  return s;
end;
$$;


revoke all on function public.claim_screen(text, text, uuid) from public, anon;
grant execute on function public.claim_screen(text, text, uuid) to authenticated;

create or replace function public.check_alerts()
returns int language plpgsql security definer set search_path = public as $$
declare
  st public.app_settings;
  r record;
  n int := 0;
  days int;
  stage text;
  place text;
  rcpt text[];
begin
  select * into st from public.app_settings where id = 1;

  for r in
    select s.*, c.name as client_name, si.name as site_name
      from public.screens s
      join public.clients c on c.id = s.client_id
      left join public.sites si on si.id = s.site_id
     where s.claimed
  loop
    place := concat_ws(' · ', r.client_name, r.site_name, r.location);

    -- offline / back online (only for TVs that are licensed)
    if public.license_ok(r.license_type, r.license_expires_at) then
      if r.offline_since is null and r.last_seen < now() - make_interval(mins => st.alert_offline_minutes) then
        insert into public.notifications (client_id, screen_id, kind, title, body)
        values (r.client_id, r.id, 'offline', r.name || ' is offline',
                'Not seen since ' || to_char(r.last_seen at time zone 'Europe/London', 'HH24:MI DD Mon') || '. ' || place || '. Check the TV is on and connected to the internet.');
        update public.screens set offline_since = now() where id = r.id;
        n := n + 1;
      elsif r.offline_since is not null and r.last_seen > r.offline_since then
        insert into public.notifications (client_id, screen_id, kind, title, body)
        values (r.client_id, r.id, 'online', r.name || ' is back online', place || '.');
        update public.screens set offline_since = null where id = r.id;
        n := n + 1;
      end if;
    end if;

    -- licence reminders
    if r.license_type is not null and r.license_type <> 'lifetime' and r.license_expires_at is not null then
      days := ceil(extract(epoch from r.license_expires_at - now()) / 86400)::int;
      stage := case when days <= 0 then 'expired' when days <= 3 then '3d' when days <= 14 then '14d' else null end;
      if stage is null and r.license_notice is not null then
        update public.screens set license_notice = null where id = r.id;
      elsif stage is not null and coalesce(r.license_notice, '') <> stage
            and coalesce(r.license_notice, '') <> 'expired' and not (coalesce(r.license_notice, '') = '3d' and stage = '14d') then
        insert into public.notifications (client_id, screen_id, kind, title, body)
        values (r.client_id, r.id, 'licence_' || stage,
                case stage when 'expired' then 'Licence expired: ' || r.name
                           else 'Licence ends in ' || days || ' day' || case when days = 1 then '' else 's' end || ': ' || r.name end,
                case when r.license_type = 'trial7' then 'Free trial' else 'Licence' end || ' for ' || r.name || ' (' || place || ') '
                  || case stage when 'expired' then 'ended on ' else 'ends on ' end || to_char(r.license_expires_at, 'DD Mon YYYY')
                  || case when stage = 'expired' and r.license_type = 'trial7' then '. The screen has stopped playing: buy a licence to turn it back on.'
                           when stage = 'expired' then '. The screen keeps playing for 7 days, then stops.' else '. Renew to avoid interruption.' end);
        update public.screens set license_notice = stage where id = r.id;
        n := n + 1;
      end if;
    end if;
  end loop;

  -- emails for new notifications
  if st.alerts_email_enabled then
    for r in select nt.*, c.contact_email from public.notifications nt left join public.clients c on c.id = nt.client_id
              where not nt.emailed and nt.created_at > now() - interval '1 day' order by nt.id limit 50
    loop
      rcpt := array(select distinct e from (
                select p.email as e from public.profiles p where p.is_admin and p.email is not null
                union select st.admin_alert_email where st.admin_alert_email is not null
                union select r.contact_email where st.alerts_to_clients and r.contact_email is not null
                union select p.email from public.client_members m join public.profiles p on p.id = m.user_id
                       where st.alerts_to_clients and m.client_id = r.client_id and m.role = 'manager'
              ) x where e is not null and e <> '');
      perform public._send_email(rcpt, r.title, public._email_html(r.title, r.body));
      update public.notifications set emailed = true where id = r.id;
    end loop;
  else
    update public.notifications set emailed = true where not emailed;
  end if;

  perform public.check_payments();
  return n;
end;
$$;
