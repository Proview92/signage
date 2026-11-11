-- Live check of 045 (licence per location + per TV). One DO block that ends with RAISE EXCEPTION, so everything is
-- rolled back: the error message IS the PASS/FAIL report. Before 045 is applied, replace the --MIGRATION-- line with:
-- execute $mig$ <contents of 045_per_location_licence.sql> $mig$;
-- The hub token is swapped for a test token inside the transaction (rolled back with everything else).
do $t$
declare
  r text := '';
  master uuid := (select id from auth.users where email = 'altun@proviewtech.co.uk');
  tok text := 'pl-test-token-' || gen_random_uuid();
  dev1 uuid := gen_random_uuid(); dev2 uuid := gen_random_uuid();
  before_ok text; after_ok text; before_s text; after_s text;
  cid uuid; sid uuid; j jsonb; j_list jsonb; s public.screens; ok boolean; msg text; n int; nsites int; owner uuid;
begin
  -- existing TVs: which can play today (TV licence only), and their licences
  select md5(coalesce(string_agg(id::text || public.license_ok(license_type, license_expires_at)::text, ',' order by id), '')) into before_ok
    from public.screens where claimed;
  select md5(coalesce(string_agg(id::text || coalesce(license_type, '-') || coalesce(license_expires_at::text, '-'), ',' order by id), '')) into before_s
    from public.screens;
  select count(*) into nsites from public.sites;

  --MIGRATION--

  update hub_private.config set token_sha256 = encode(extensions.digest(tok, 'sha256'), 'hex') where id = 1;

  -- ---------- 1. existing locations: lifetime; existing TVs play exactly as before
  r := r || format(E'%s existing locations lifetime: %s of %s\n',
    case when (select count(*) from public.sites where license_type = 'lifetime') = nsites then 'PASS' else 'FAIL' end,
    (select count(*) from public.sites where license_type = 'lifetime'), nsites);
  select md5(coalesce(string_agg(id::text || public.tv_licence_ok(license_type, license_expires_at, site_license_type, site_license_expires_at)::text, ',' order by id), '')) into after_ok
    from public.screens where claimed;
  r := r || format(E'%s existing TVs: can play exactly as before (%s claimed TVs, every copy filled: %s)\n',
    case when before_ok = after_ok and not exists (select 1 from public.screens where claimed and client_id is not null and site_license_type is null) then 'PASS' else 'FAIL' end,
    (select count(*) from public.screens where claimed), not exists (select 1 from public.screens where claimed and client_id is not null and site_license_type is null));
  select md5(coalesce(string_agg(id::text || coalesce(license_type, '-') || coalesce(license_expires_at::text, '-'), ',' order by id), '')) into after_s
    from public.screens;
  r := r || format(E'%s existing TV licences unchanged\n', case when before_s = after_s then 'PASS' else 'FAIL' end);

  -- ---------- 2. a new business (master's Add business): its location has no licence
  perform set_config('request.jwt.claims', json_build_object('sub', master, 'role', 'authenticated', 'email', 'altun@proviewtech.co.uk')::text, true);
  perform set_config('request.jwt.claim.sub', master::text, true);
  execute 'set local role authenticated';
  j := public.add_business('PL Test Biz', 'PL Owner', 'pl-owner@test.invalid', null, 'secret123');
  execute 'reset role';
  cid := (j->>'client_id')::uuid; owner := (j->>'user_id')::uuid;
  if owner is null then select user_id into owner from public.client_members where client_id = cid limit 1; end if;
  select id into sid from public.sites where client_id = cid;
  r := r || format(E'%s new location has no licence (%s)\n',
    case when sid is not null and (select license_type from public.sites where id = sid) is null then 'PASS' else 'FAIL' end,
    coalesce((select license_type from public.sites where id = sid), 'none'));
  -- hub add_business path too
  j := public.hub_call(tok, 'add_business', jsonb_build_object('business', 'PL Hub Biz', 'name', 'PL Hub Owner', 'email', 'pl-hub@test.invalid', 'password', 'secret123'));
  r := r || format(E'%s hub add_business: new location has no licence\n',
    case when (select bool_and(license_type is null) from public.sites where client_id = (j->>'client_id')::uuid) then 'PASS' else 'FAIL' end);

  -- the master's 3-day trial (044): the location gets the same trial
  perform set_config('request.jwt.claims', json_build_object('sub', master, 'role', 'authenticated', 'email', 'altun@proviewtech.co.uk')::text, true);
  perform set_config('request.jwt.claim.sub', master::text, true);
  execute 'set local role authenticated';
  j := public.add_business('PL Trial Biz', 'PL Trial Owner', 'pl-trial@test.invalid', null, 'secret123');
  j := public.master_trial((j->>'client_id')::uuid) || jsonb_build_object('cid', j->>'client_id');
  execute 'reset role';
  r := r || format(E'%s master''s 3-day trial: location gets trial7 to the business trial end (%s)\n',
    case when (j->>'applied')::boolean and (select bool_and(license_type = 'trial7' and license_expires_at = (j->>'expires_at')::timestamptz) from public.sites where client_id = (j->>'cid')::uuid) then 'PASS' else 'FAIL' end,
    (select string_agg(coalesce(license_type, 'none'), ',') from public.sites where client_id = (j->>'cid')::uuid));

  -- self-signup ("Set up your business")
  insert into auth.users (instance_id, id, aud, role, email, is_anonymous, created_at, updated_at) values
    ('00000000-0000-0000-0000-000000000000', dev2, 'authenticated', 'authenticated', 'pl-self@test.invalid', false, now(), now());
  perform set_config('request.jwt.claims', json_build_object('sub', dev2, 'role', 'authenticated', 'email', 'pl-self@test.invalid', 'is_anonymous', false)::text, true);
  perform set_config('request.jwt.claim.sub', dev2::text, true);
  execute 'set local role authenticated';
  j := to_jsonb(public.create_my_business('PL Self Biz', null, null));
  execute 'reset role';
  r := r || format(E'%s self-signup: new location has no licence\n',
    case when (select bool_and(license_type is null) from public.sites where client_id = (j#>>'{}')::uuid) then 'PASS' else 'FAIL' end);

  -- a TV paired to it (as the database: the TV row is the device's)
  insert into auth.users (instance_id, id, aud, role, email, is_anonymous, created_at, updated_at) values
    ('00000000-0000-0000-0000-000000000000', dev1, 'authenticated', 'authenticated', null, true, now(), now());
  insert into public.screens (device_user_id, claimed, name, client_id) values (dev1, true, 'PL TV', cid) returning * into s;
  r := r || format(E'%s TV in the new business: location copy filled from its location (site %s, copy %s)\n',
    case when s.site_id = sid and s.site_license_type is null then 'PASS' else 'FAIL' end, s.site_id = sid, coalesce(s.site_license_type, 'none'));

  -- ---------- 3. both licences needed
  j := public.hub_call(tok, 'set', jsonb_build_object('unit', s.id::text, 'type', 'm12'));   -- no kind: a TV, as before
  select * into s from public.screens where id = s.id;
  r := r || format(E'%s set without kind = TV licence (%s, kind %s); TV licensed but location not: can''t play (%s)\n',
    case when s.license_type = 'm12' and j->>'kind' = 'screen' and not public.tv_licence_ok(s.license_type, s.license_expires_at, s.site_license_type, s.site_license_expires_at) then 'PASS' else 'FAIL' end,
    s.license_type, j->>'kind', public.tv_licence_ok(s.license_type, s.license_expires_at, s.site_license_type, s.site_license_expires_at));
  -- publish is refused with the location wording
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated', 'email', 'pl-owner@test.invalid', 'is_anonymous', false)::text, true);
  perform set_config('request.jwt.claim.sub', owner::text, true);
  execute 'set local role authenticated';
  ok := true; msg := null;
  begin perform public.publish_screen(s.id); exception when others then ok := false; msg := sqlerrm; end;
  execute 'reset role';
  r := r || format(E'%s publish to a TV in an unlicensed location refused (%s)\n',
    case when not ok and msg like 'The location of%needs a licence%' then 'PASS' else 'FAIL' end, coalesce(msg, 'allowed'));

  j := public.hub_call(tok, 'set', jsonb_build_object('unit', 'loc/' || sid, 'type', 'm12'));   -- loc/ unit, no kind
  select * into s from public.screens where id = s.id;
  r := r || format(E'%s set loc/<site> (no kind) = location licence (%s, kind %s, id %s); TV copy follows (%s); both valid: plays (%s)\n',
    case when (select license_type from public.sites where id = sid) = 'm12' and j->>'kind' = 'location' and j->>'id' = 'loc/' || sid
          and s.site_license_type = 'm12' and public.tv_licence_ok(s.license_type, s.license_expires_at, s.site_license_type, s.site_license_expires_at) then 'PASS' else 'FAIL' end,
    (select license_type from public.sites where id = sid), j->>'kind', j->>'id', s.site_license_type,
    public.tv_licence_ok(s.license_type, s.license_expires_at, s.site_license_type, s.site_license_expires_at));
  -- the owner can publish now (schedule feature: owner = manager has every feature)
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated', 'email', 'pl-owner@test.invalid', 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
  ok := true; msg := null;
  begin perform public.publish_screen(s.id); exception when others then ok := false; msg := sqlerrm; end;
  execute 'reset role';
  r := r || format(E'%s publish allowed with both licences (%s)\n', case when ok then 'PASS' else 'FAIL' end, coalesce(msg, 'ok'));

  -- location licence ended (past the 7-day grace): TV can't play although its own licence is valid
  j := public.hub_call(tok, 'set', jsonb_build_object('unit', sid::text, 'kind', 'location', 'type', 'custom', 'expires', (now() - interval '10 days')::text));
  select * into s from public.screens where id = s.id;
  r := r || format(E'%s kind=location with a bare site id works; location expired: TV can''t play (%s)\n',
    case when j->>'kind' = 'location' and s.site_license_expires_at < now() and not public.tv_licence_ok(s.license_type, s.license_expires_at, s.site_license_type, s.site_license_expires_at) then 'PASS' else 'FAIL' end,
    public.tv_licence_ok(s.license_type, s.license_expires_at, s.site_license_type, s.site_license_expires_at));
  -- extend on top (m1 from now, since it has ended), then clear
  j := public.hub_call(tok, 'set', jsonb_build_object('unit', 'loc/' || sid, 'type', 'm1', 'extend', true));
  r := r || format(E'%s location extend after the end starts from now (%s)\n',
    case when (j->>'expires_at')::timestamptz between now() + interval '27 days' and now() + interval '32 days' then 'PASS' else 'FAIL' end, j->>'expires_at');
  j := public.hub_call(tok, 'set', jsonb_build_object('unit', 'loc/' || sid, 'type', null));
  select * into s from public.screens where id = s.id;
  r := r || format(E'%s location licence cleared: TV copy cleared too (%s)\n',
    case when j->>'license_type' is null and s.site_license_type is null then 'PASS' else 'FAIL' end, coalesce(s.site_license_type, 'none'));

  -- ---------- 4. hub list
  j := public.hub_call(tok, 'list', '{}'); j_list := j->'units';
  r := r || format(E'%s list: location units %s (one per location: %s), TV units with kind screen %s, every unit has a kind %s\n',
    case when (select count(*) from jsonb_array_elements(j->'units') u where u->>'kind' = 'location') = (select count(*) from public.sites where client_id is not null)
          and exists (select 1 from jsonb_array_elements(j->'units') u where u->>'id' = 'loc/' || sid and u->>'kind' = 'location' and u->>'account_id' = cid::text and u->>'location_id' = sid::text)
          and exists (select 1 from jsonb_array_elements(j->'units') u where u->>'id' = s.id::text and u->>'kind' = 'screen' and u->>'location_id' = sid::text)
          and not exists (select 1 from jsonb_array_elements(j->'units') u where u->>'kind' is null)
          and jsonb_array_length(j->'accounts') = (select count(*) from public.clients) then 'PASS' else 'FAIL' end,
    (select count(*) from jsonb_array_elements(j->'units') u where u->>'kind' = 'location'), (select count(*) from public.sites where client_id is not null),
    (select count(*) from jsonb_array_elements(j->'units') u where u->>'kind' = 'screen'),
    not exists (select 1 from jsonb_array_elements(j->'units') u where u->>'kind' is null));

  -- ---------- 5. wrong token, non-master
  ok := true; begin perform public.hub_call('wrong', 'list', '{}'); exception when others then ok := false; msg := sqlerrm; end;
  r := r || format(E'%s list with a wrong token refused (%s)\n', case when not ok and msg = 'not authorised' then 'PASS' else 'FAIL' end, msg);
  ok := true; begin perform public.hub_call('wrong', 'set', jsonb_build_object('unit', 'loc/' || sid, 'type', 'lifetime')); exception when others then ok := false; msg := sqlerrm; end;
  r := r || format(E'%s set location with a wrong token refused (%s), still unlicensed: %s\n',
    case when not ok and msg = 'not authorised' and (select license_type from public.sites where id = sid) is null then 'PASS' else 'FAIL' end, msg,
    (select license_type from public.sites where id = sid) is null);
  ok := true; begin perform public.hub_plans('wrong', '{}'); exception when others then ok := false; msg := sqlerrm; end;
  r := r || format(E'%s hub_plans with a wrong token refused\n', case when not ok then 'PASS' else 'FAIL' end);
  -- the owner (a non-master) can't set the location licence directly
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated', 'email', 'pl-owner@test.invalid', 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
  ok := true; begin update public.sites set license_type = 'lifetime' where id = sid; get diagnostics n = row_count; exception when others then ok := false; msg := sqlerrm; end;
  ok := ok and n > 0;
  begin update public.screens set site_license_type = 'lifetime' where id = s.id; exception when others then null; end;
  execute 'reset role';
  r := r || format(E'%s owner can''t set the location licence (%s); TV copy can''t be faked (%s)\n',
    case when not ok and (select license_type from public.sites where id = sid) is null and (select site_license_type from public.screens where id = s.id) is null then 'PASS' else 'FAIL' end,
    coalesce(msg, 'allowed'), coalesce((select site_license_type from public.screens where id = s.id), 'none'));
  -- the master's own app can't either (licences come from the portal)
  perform set_config('request.jwt.claims', json_build_object('sub', master, 'role', 'authenticated', 'email', 'altun@proviewtech.co.uk')::text, true);
  execute 'set local role authenticated';
  ok := true; begin update public.sites set license_type = 'lifetime' where id = sid; exception when others then ok := false; msg := sqlerrm; end;
  execute 'reset role';
  r := r || format(E'%s master''s app can''t set it directly either (%s)\n', case when not ok then 'PASS' else 'FAIL' end, coalesce(msg, 'allowed'));

  -- ---------- 6. prices per kind
  j := public.hub_plans(tok, '{"m12":{"label":"12 months","amount":5000,"currency":"gbp","link":"https://buy.stripe.com/x","ref":"pvs"}}');
  r := r || format(E'%s hub_plans old flat form = TV prices (%s)\n',
    case when (select plans from hub_private.config) -> 'screen' ? 'm12' and (select plans from hub_private.config) -> 'location' = '{}'::jsonb then 'PASS' else 'FAIL' end, j);
  j := public.hub_plans(tok, '{"screen":{"m12":{"label":"12 months","amount":5000,"currency":"gbp","link":"https://buy.stripe.com/tv","ref":"pvs"}},"location":{"m1":{"label":"1 month","amount":900,"currency":"gbp","link":"https://buy.stripe.com/loc","ref":"pvs"}}}');
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated', 'email', 'pl-owner@test.invalid', 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
  j := jsonb_build_object('flat', public.licence_buy_plans(), 'kinds', public.licence_buy_plans_by_kind());
  execute 'reset role';
  r := r || format(E'%s hub_plans per-kind form; licence_buy_plans = TV prices (old pages), by_kind has both (%s)\n',
    case when j->'flat' ? 'm12' and not (j->'flat' ? 'm1') and not (j->'flat' ? 'screen')
          and j->'kinds'->'location'->'m1'->>'link' = 'https://buy.stripe.com/loc' and j->'kinds'->'screen' ? 'm12' then 'PASS' else 'FAIL' end, j);

  -- ---------- 7. running the migration again changes nothing: new locations stay unlicensed, hub_call still works
  --MIGRATION--
  r := r || format(E'%s second run: new locations still unlicensed (%s), existing still lifetime, hub list still works (%s units)\n',
    case when (select count(*) from public.sites where license_type = 'lifetime') = nsites
          and (select license_type from public.sites where id = sid) is null
          and jsonb_array_length(public.hub_call(tok, 'list', '{}')->'units') = jsonb_array_length(j_list) then 'PASS' else 'FAIL' end,
    (select count(*) from public.sites where license_type is null), jsonb_array_length(public.hub_call(tok, 'list', '{}')->'units'));

  raise exception E'ROLLED BACK. Results:\n%', r;
end $t$;
