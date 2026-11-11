-- 044: the master's "+ Add business" can start the business on a 3-day trial (ADD_BUSINESS_D_SPEC, owner 11 Nov 2026).
--
-- Owner: "Bring back a trial here only". Everything else stays no-trial (migration 042): self-signup, add_business,
-- the licence portal's New customer (hub_call 'add_business') and any direct insert still start with no trial
-- (the clients_no_trial insert trigger clears trial_ends_at). Only the master, from the Add business dialog, can
-- choose "3-day trial" for a business, right after adding it.
--
-- Signage licences are per TV. A business trial is clients.trial_ends_at (032): while it runs, a TV paired to the
-- business through claim_screen gets a 'trial7' licence that ends with the business trial (the existing once-per-device
-- rule, trial_devices, still applies). When it ends, TVs on that trial show the TV app's "no licence" screen until a
-- licence is bought. An UPDATE is not touched by the clients_no_trial trigger (insert only).
--
-- master_trial(p_client): Proview master only. Sets trial_ends_at = now() + 3 days. It never replaces a licence that is
-- already set: if the business already has a trial end date, or any of its TVs has a licence, nothing changes.
-- Returns { applied, expires_at }.
-- Safe to run more than once.

create or replace function public.master_trial(p_client uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare c public.clients; e timestamptz := now() + interval '3 days';
begin
  if not public.is_admin() then raise exception 'Only the Proview master can start a trial.'; end if;
  select * into c from public.clients where id = p_client for update;
  if not found then raise exception 'Business not found.'; end if;
  if c.trial_ends_at is not null
     or exists (select 1 from public.screens s where s.client_id = p_client and s.license_type is not null) then
    return jsonb_build_object('applied', false, 'expires_at', c.trial_ends_at);
  end if;
  update public.clients set trial_ends_at = e where id = p_client;
  return jsonb_build_object('applied', true, 'expires_at', e);
end;
$$;
revoke all on function public.master_trial(uuid) from public, anon;
grant execute on function public.master_trial(uuid) to authenticated;
