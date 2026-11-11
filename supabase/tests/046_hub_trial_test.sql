-- Live check of 046 (hub_call 'trial' for the licence portal's New customer). One DO block that ends with RAISE EXCEPTION,
-- so everything is rolled back: the error message IS the PASS/FAIL report. Before 046 is applied, replace the
-- --MIGRATION-- lines with:   execute $mig$ <contents of 046_hub_trial.sql> $mig$;
-- The hub token is swapped for a test token inside the transaction (rolled back with everything else).
do $t$
declare
  r text := '';
  tok text := 'nc-test-token-' || gen_random_uuid();
  em text := 'nc-trial-test-' || substr(md5(random()::text), 1, 8) || '@example.com';
  master uuid := (select p.id from public.profiles p where p.is_admin order by p.created_at limit 1);
  n_before int; n_after int; j jsonb; t jsonb; t2 jsonb; cid uuid; si public.sites; c public.clients; s public.screens;
  code text := 'NC' || upper(substr(md5(random()::text), 1, 6)); ok boolean; msg text; lst jsonb; dev uuid := gen_random_uuid();
begin
  update hub_private.config set token_sha256 = encode(extensions.digest(tok, 'sha256'), 'hex') where id = 1;
  n_before := jsonb_array_length(public.hub_call(tok, 'list', '{}')->'units');

  --MIGRATION--

  -- 1. every other action still goes to the old hub_call
  n_after := jsonb_array_length(public.hub_call(tok, 'list', '{}')->'units');
  r := r || format(E'%s list unchanged after the migration (%s units)\n', case when n_before = n_after then 'PASS' else 'FAIL' end, n_after);
  r := r || format(E'%s old hub_call moved to hub_private.hub_call_pre_trial, not callable by anon/authenticated\n',
    case when to_regprocedure('hub_private.hub_call_pre_trial(text,text,jsonb)') is not null
          and not has_function_privilege('anon', 'hub_private.hub_call_pre_trial(text,text,jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'hub_private.hub_call_pre_trial(text,text,jsonb)', 'execute') then 'PASS' else 'FAIL' end);

  -- 2. a wrong token is refused
  begin perform public.hub_call('wrong', 'trial', '{}'); ok := false; exception when others then ok := sqlerrm = 'not authorised'; end;
  r := r || format(E'%s trial with a wrong token: refused\n', case when ok then 'PASS' else 'FAIL' end);

  -- 3. New customer: add_business through the hub (as the portal does), then the trial
  j := public.hub_call(tok, 'add_business', jsonb_build_object('business', 'NC Trial Test', 'name', 'Nc Tester', 'email', em,
         'mobile', null, 'password', 'Rand0m-' || md5(random()::text), 'contact_email', em));
  cid := (j->>'account_id')::uuid;
  select * into c from public.clients where id = cid;
  r := r || format(E'%s add_business via hub: business made, no trial yet (trial_ends_at %s)\n',
    case when cid is not null and c.trial_ends_at is null then 'PASS' else 'FAIL' end, c.trial_ends_at);

  t := public.hub_call(tok, 'trial', jsonb_build_object('account_id', cid));
  select * into c from public.clients where id = cid;
  select * into si from public.sites where client_id = cid order by created_at limit 1;
  r := r || format(E'%s trial via hub: applied, business trial ends in 3 days (%s)\n',
    case when (t->>'applied')::boolean and abs(extract(epoch from (c.trial_ends_at - (now() + interval '3 days')))) < 5
          and (t->>'expires_at')::timestamptz = c.trial_ends_at then 'PASS' else 'FAIL' end, t);
  r := r || format(E'%s its location: trial7 ending with the business trial (%s until %s)\n',
    case when si.license_type = 'trial7' and si.license_expires_at = c.trial_ends_at then 'PASS' else 'FAIL' end, si.license_type, si.license_expires_at);

  -- 4. a TV paired during the trial plays (TV gets the trial; its location's licence is valid too)
  insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at)
  values (dev, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, now(), now());   -- the TV's own device login
  insert into public.screens (device_user_id, pairing_code, hardware_id) values (dev, code, 'nc-test-hw-' || gen_random_uuid()) returning * into s;
  perform set_config('request.jwt.claims', json_build_object('sub', master, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', master::text, true);
  begin perform public.claim_screen(code, 'NC test TV', cid); msg := null; exception when others then msg := sqlerrm; end;
  select * into s from public.screens where id = s.id;
  r := r || format(E'%s TV paired during the trial: %s until %s, location copy %s, plays: %s %s\n',
    case when msg is null and s.license_type = 'trial7' and s.license_expires_at = c.trial_ends_at and s.site_license_type = 'trial7'
          and public.tv_licence_ok(s.license_type, s.license_expires_at, s.site_license_type, s.site_license_expires_at) then 'PASS' else 'FAIL' end,
    s.license_type, s.license_expires_at, s.site_license_type,
    public.tv_licence_ok(s.license_type, s.license_expires_at, s.site_license_type, s.site_license_expires_at), coalesce(msg, ''));
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);

  -- 5. never twice, never over a licence
  t2 := public.hub_call(tok, 'trial', jsonb_build_object('account_id', cid));
  r := r || format(E'%s second trial: not applied, end date unchanged (%s)\n',
    case when not (t2->>'applied')::boolean and (select trial_ends_at from public.clients where id = cid) = c.trial_ends_at then 'PASS' else 'FAIL' end, t2);

  -- 6. the portal sees the trial on the location unit
  lst := public.hub_call(tok, 'list', '{}');
  r := r || format(E'%s list: the new location unit shows trial7 (%s)\n',
    case when exists (select 1 from jsonb_array_elements(lst->'units') u where u->>'id' = 'loc/' || si.id and u->>'license_type' = 'trial7' and u->>'kind' = 'location')
    then 'PASS' else 'FAIL' end, si.id);

  -- 7. bad account ids are refused, and the hub's own claims are put back
  begin perform public.hub_call(tok, 'trial', '{"account_id":"nope"}'); ok := false; exception when others then ok := sqlerrm = 'Business not found.'; end;
  r := r || format(E'%s trial with a bad business id: refused\n', case when ok then 'PASS' else 'FAIL' end);
  begin perform public.hub_call(tok, 'trial', jsonb_build_object('account_id', gen_random_uuid())); ok := false; exception when others then ok := sqlerrm = 'Business not found.'; end;
  r := r || format(E'%s trial for an unknown business: refused\n', case when ok then 'PASS' else 'FAIL' end);
  r := r || format(E'%s claims put back after the call (sub "%s")\n', case when coalesce(current_setting('request.jwt.claim.sub', true), '') = '' then 'PASS' else 'FAIL' end,
    coalesce(current_setting('request.jwt.claim.sub', true), ''));

  -- 8. the dashboard SSO can hand this owner in (no app password needed: sso-login uses a magic link)
  select to_jsonb(x) into j from public.sso_entitled(em) x;
  r := r || format(E'%s sso_entitled(owner): %s\n', case when (j->>'ok')::boolean then 'PASS' else 'FAIL' end, j);

  -- 9. running the migration again changes nothing
  --MIGRATION--
  r := r || format(E'%s second run: list still works (%s units), trial still works (applied=%s)\n',
    case when jsonb_array_length(public.hub_call(tok, 'list', '{}')->'units') > n_after
          and public.hub_call(tok, 'trial', jsonb_build_object('account_id', cid)) ? 'applied' then 'PASS' else 'FAIL' end,
    jsonb_array_length(public.hub_call(tok, 'list', '{}')->'units'), public.hub_call(tok, 'trial', jsonb_build_object('account_id', cid))->>'applied');

  raise exception E'ROLLED BACK. Results:\n%', r;
end $t$;
