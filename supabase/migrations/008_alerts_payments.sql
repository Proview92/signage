-- =====================================================================
--  PROVIEW SIGNAGE — alerts (in-app + email) and online licence payments
--  Run after 007_features.sql. Safe to re-run.
--
--  A job runs every 5 minutes (pg_cron):
--    • TV offline / back online, licence ending in 14 / 3 days, expired
--      → notifications in the dashboard + emails via Resend (optional)
--    • Stripe Payment Links: paid checkouts extend the TV's licence
--  API keys are stored encrypted in Supabase Vault, entered by the admin.
-- =====================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------
--  Settings
-- ---------------------------------------------------------------------
alter table public.app_settings add column if not exists alerts_email_enabled  boolean not null default false;
alter table public.app_settings add column if not exists alert_offline_minutes int not null default 15;
alter table public.app_settings add column if not exists alerts_to_clients     boolean not null default false;
alter table public.app_settings add column if not exists admin_alert_email     text;
alter table public.app_settings add column if not exists email_from            text not null default 'PROVIEW SIGNAGE <onboarding@resend.dev>';
alter table public.app_settings add column if not exists stripe_enabled        boolean not null default false;
alter table public.app_settings add column if not exists stripe_plans          jsonb not null default '{}'::jsonb;
alter table public.app_settings add column if not exists stripe_last_created   bigint not null default 0;
alter table public.app_settings add column if not exists stripe_pending        bigint;
alter table public.app_settings add column if not exists stripe_last_error     text;
alter table public.app_settings add column if not exists stripe_checked_at     timestamptz;

alter table public.screens add column if not exists offline_since  timestamptz;
alter table public.screens add column if not exists license_notice text;

-- Clients can read the public parts of the payment settings (plans/links).
create or replace function public.get_payment_plans()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when stripe_enabled then stripe_plans else '{}'::jsonb end from public.app_settings where id = 1;
$$;
grant execute on function public.get_payment_plans() to authenticated;

-- ---------------------------------------------------------------------
--  Notifications
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id          bigserial primary key,
  client_id   uuid references public.clients(id) on delete cascade,
  screen_id   uuid references public.screens(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  created_at  timestamptz not null default now(),
  emailed     boolean not null default false
);
create index if not exists notifications_idx on public.notifications(client_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
  using (public.is_admin() or (client_id is not null and public.is_member(client_id)));

-- ---------------------------------------------------------------------
--  Vault helpers (admin only)
-- ---------------------------------------------------------------------
create or replace function public._secret(p_name text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v using p_name;
  return v;
exception when others then return null;
end;
$$;
revoke all on function public._secret(text) from public, anon, authenticated;

create or replace function public._set_secret(p_name text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  execute 'select id from vault.secrets where name = $1 limit 1' into sid using p_name;
  if p_value is null or p_value = '' then
    if sid is not null then execute 'delete from vault.secrets where id = $1' using sid; end if;
  elsif sid is null then
    execute 'select vault.create_secret($1, $2)' using p_value, p_name;
  else
    execute 'select vault.update_secret($1, $2)' using sid, p_value;
  end if;
end;
$$;
revoke all on function public._set_secret(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
--  Email (Resend)
-- ---------------------------------------------------------------------
create or replace function public._send_email(p_to text[], p_subject text, p_html text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare
  k text := public._secret('resend_api_key');
  f text := (select email_from from public.app_settings where id = 1);
begin
  if k is null or p_to is null or array_length(p_to, 1) is null then return false; end if;
  perform net.http_post(
    url := 'https://api.resend.com/emails',
    body := jsonb_build_object('from', f, 'to', to_jsonb(p_to), 'subject', p_subject, 'html', p_html),
    headers := jsonb_build_object('Authorization', 'Bearer ' || k, 'Content-Type', 'application/json'));
  return true;
exception when others then return false;
end;
$$;
revoke all on function public._send_email(text[], text, text) from public, anon, authenticated;

create or replace function public._email_html(p_title text, p_body text)
returns text language sql immutable as $$
  select '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;padding:24px">'
      || '<div style="font-weight:800;letter-spacing:.06em;margin-bottom:18px">PROVIEW <span style="color:#ff5a1f;font-weight:500">SIGNAGE</span></div>'
      || '<h2 style="margin:0 0 10px;font-size:20px">' || replace(replace(p_title, '<', '&lt;'), '>', '&gt;') || '</h2>'
      || '<p style="color:#444;line-height:1.5;margin:0">' || replace(replace(coalesce(p_body, ''), '<', '&lt;'), '>', '&gt;') || '</p>'
      || '<p style="color:#999;font-size:12px;margin-top:28px">Automatic alert from PROVIEW SIGNAGE.</p></div>';
$$;

-- ---------------------------------------------------------------------
--  The 5-minute check
-- ---------------------------------------------------------------------
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
                  || case stage when 'expired' then '. The screen keeps playing for 7 days, then stops.' else '. Renew to avoid interruption.' end);
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
revoke all on function public.check_alerts() from public, anon, authenticated;

-- ---------------------------------------------------------------------
--  Stripe Payment Links → licences
--  Each plan has a Payment Link. The dashboard opens it with
--  ?client_reference_id=<screen-id>__<plan>. Every 5 minutes we read
--  recent paid Checkout Sessions (restricted key: Checkout Sessions read)
--  and extend licences when the amount paid matches the plan.
-- ---------------------------------------------------------------------
create table if not exists public.payments (
  session_id    text primary key,
  screen_id     uuid references public.screens(id) on delete set null,
  client_id     uuid references public.clients(id) on delete set null,
  license_type  text,
  amount        int,
  currency      text,
  email         text,
  paid_at       timestamptz not null default now(),
  applied       boolean not null default false,
  note          text
);
alter table public.payments enable row level security;
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments for select to authenticated
  using (public.is_admin() or (client_id is not null and public.is_member(client_id, array['manager'])));

create or replace function public.check_payments()
returns int language plpgsql security definer set search_path = public, extensions as $$
declare
  st public.app_settings;
  k text;
  resp record;
  x jsonb;
  ref text; scr uuid; plan text; p jsonb;
  s public.screens;
  base timestamptz;
  n int := 0;
  maxc bigint;
begin
  select * into st from public.app_settings where id = 1;
  if not st.stripe_enabled then return 0; end if;
  k := public._secret('stripe_secret_key');
  if k is null then return 0; end if;

  -- 1) read the previous request's response
  if st.stripe_pending is not null then
    select * into resp from net._http_response where id = st.stripe_pending;
    if found then
      if resp.status_code = 200 then
        maxc := st.stripe_last_created;
        for x in select * from jsonb_array_elements(coalesce(resp.content::jsonb -> 'data', '[]'::jsonb)) loop
          maxc := greatest(maxc, (x ->> 'created')::bigint);
          continue when x ->> 'payment_status' <> 'paid';
          ref := x ->> 'client_reference_id';
          continue when ref is null or ref !~ '^[0-9a-f-]{36}__[a-z0-9]+$';
          scr := split_part(ref, '__', 1)::uuid; plan := split_part(ref, '__', 2);
          p := st.stripe_plans -> plan;
          insert into public.payments (session_id, screen_id, license_type, amount, currency, email, note)
          values (x ->> 'id', scr, plan, (x ->> 'amount_total')::int, x ->> 'currency', x -> 'customer_details' ->> 'email', null)
          on conflict (session_id) do nothing;
          continue when not found;
          select * into s from public.screens where id = scr;
          if s.id is null or p is null then
            update public.payments set note = 'Unknown screen or plan' where session_id = x ->> 'id'; continue;
          end if;
          update public.payments set client_id = s.client_id where session_id = x ->> 'id';
          if (x ->> 'amount_total')::int < coalesce((p ->> 'amount')::int, 0) or lower(x ->> 'currency') <> lower(coalesce(p ->> 'currency', 'gbp')) then
            update public.payments set note = 'Amount does not match the plan; not applied' where session_id = x ->> 'id'; continue;
          end if;
          if plan = 'lifetime' then
            update public.screens set license_type = 'lifetime', license_expires_at = null, license_updated_at = now(),
                   license_notes = 'Paid online ' || to_char(now(), 'DD Mon YYYY') where id = scr;
          else
            base := case when s.license_expires_at is not null and s.license_expires_at > now() and s.license_type <> 'lifetime' then s.license_expires_at else now() end;
            update public.screens set license_type = plan, license_starts_at = coalesce(license_starts_at, now()),
                   license_expires_at = base + public.license_interval(plan), license_updated_at = now(),
                   license_notes = 'Paid online ' || to_char(now(), 'DD Mon YYYY') where id = scr;
          end if;
          update public.payments set applied = true where session_id = x ->> 'id';
          insert into public.notifications (client_id, screen_id, kind, title, body)
          values (s.client_id, s.id, 'payment', 'Payment received: ' || s.name,
                  'Licence renewed online (' || plan || '). Paid ' || upper(x ->> 'currency') || ' ' || to_char((x ->> 'amount_total')::numeric / 100, 'FM999990.00') || '.');
          n := n + 1;
        end loop;
        update public.app_settings set stripe_last_created = greatest(maxc - 3600, stripe_last_created), stripe_last_error = null where id = 1;
      else
        update public.app_settings set stripe_last_error = 'Stripe said ' || resp.status_code || ': ' || left(coalesce(resp.content, ''), 200) where id = 1;
      end if;
      update public.app_settings set stripe_pending = null where id = 1;
    end if;
  end if;

  -- 2) ask for recent sessions (answer is read on the next run)
  if (select stripe_pending from public.app_settings where id = 1) is null then
    update public.app_settings
       set stripe_pending = net.http_get(
             url := 'https://api.stripe.com/v1/checkout/sessions?limit=100&created[gte]=' ||
                    greatest(st.stripe_last_created, extract(epoch from now() - interval '30 days')::bigint),
             headers := jsonb_build_object('Authorization', 'Bearer ' || k)),
           stripe_checked_at = now()
     where id = 1;
  end if;
  return n;
exception when others then
  update public.app_settings set stripe_last_error = left(sqlerrm, 200), stripe_pending = null where id = 1;
  return n;
end;
$$;
revoke all on function public.check_payments() from public, anon, authenticated;

-- ---------------------------------------------------------------------
--  Admin settings RPCs
-- ---------------------------------------------------------------------
create or replace function public.get_integration_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare st public.app_settings;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select * into st from public.app_settings where id = 1;
  return jsonb_build_object(
    'alerts_email_enabled', st.alerts_email_enabled, 'alert_offline_minutes', st.alert_offline_minutes,
    'alerts_to_clients', st.alerts_to_clients, 'admin_alert_email', st.admin_alert_email, 'email_from', st.email_from,
    'has_resend_key', public._secret('resend_api_key') is not null,
    'stripe_enabled', st.stripe_enabled, 'stripe_plans', st.stripe_plans, 'has_stripe_key', public._secret('stripe_secret_key') is not null,
    'stripe_last_error', st.stripe_last_error, 'stripe_checked_at', st.stripe_checked_at,
    'cron', (select count(*) from cron.job where jobname = 'signage-alerts') > 0);
exception when undefined_table then
  return jsonb_build_object('error', 'cron not available');
end;
$$;
grant execute on function public.get_integration_settings() to authenticated;

create or replace function public.set_integration_settings(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if p ? 'resend_api_key' then perform public._set_secret('resend_api_key', nullif(trim(p ->> 'resend_api_key'), '')); end if;
  if p ? 'stripe_secret_key' then perform public._set_secret('stripe_secret_key', nullif(trim(p ->> 'stripe_secret_key'), '')); end if;
  update public.app_settings set
    alerts_email_enabled  = coalesce((p ->> 'alerts_email_enabled')::boolean, alerts_email_enabled),
    alert_offline_minutes = coalesce((p ->> 'alert_offline_minutes')::int, alert_offline_minutes),
    alerts_to_clients     = coalesce((p ->> 'alerts_to_clients')::boolean, alerts_to_clients),
    admin_alert_email     = case when p ? 'admin_alert_email' then nullif(trim(p ->> 'admin_alert_email'), '') else admin_alert_email end,
    email_from            = coalesce(nullif(trim(p ->> 'email_from'), ''), email_from),
    stripe_enabled        = coalesce((p ->> 'stripe_enabled')::boolean, stripe_enabled),
    stripe_plans          = coalesce(p -> 'stripe_plans', stripe_plans),
    updated_at            = now()
  where id = 1;
end;
$$;
grant execute on function public.set_integration_settings(jsonb) to authenticated;

create or replace function public.send_test_email()
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if public._secret('resend_api_key') is null then raise exception 'Add your Resend API key first.'; end if;
  return public._send_email(array[coalesce((select admin_alert_email from public.app_settings where id = 1), auth.jwt() ->> 'email')],
    'PROVIEW SIGNAGE test email', public._email_html('Email alerts are working', 'You will get emails like this when a TV goes offline or a licence is about to end.'));
end;
$$;
grant execute on function public.send_test_email() to authenticated;

-- ---------------------------------------------------------------------
--  Schedule the job every 5 minutes
-- ---------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('signage-alerts') where exists (select 1 from cron.job where jobname = 'signage-alerts');
  perform cron.schedule('signage-alerts', '*/5 * * * *', 'select public.check_alerts()');
exception when others then
  raise notice 'Could not schedule job: %', sqlerrm;
end $$;
