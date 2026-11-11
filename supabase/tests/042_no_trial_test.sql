-- Live check of 042 (no free trials). One DO block that ends with RAISE EXCEPTION, so everything is rolled back:
-- the error message IS the PASS/FAIL report. Before 042 is applied, run it with the migration executed first
-- (replace the --MIGRATION-- line with: execute $mig$ <contents of 042_no_trial.sql> $mig$;).
do $t$
declare
  r text := '';
  master uuid := (select id from auth.users where email = 'altun@proviewtech.co.uk');
  o1 uuid := gen_random_uuid(); o2 uuid := gen_random_uuid(); o3 uuid := gen_random_uuid();
  dev1 uuid := gen_random_uuid(); dev2 uuid := gen_random_uuid(); dev3 uuid := gen_random_uuid(); dev4 uuid := gen_random_uuid(); dev5 uuid := gen_random_uuid();
  ctr uuid := gen_random_uuid();
  before_c text; before_s text; after_c text; after_s text;
  cid uuid; x uuid; j jsonb; s public.screens; ok boolean; msg text; n int; te timestamptz;
begin
  -- existing businesses / licences, before anything runs
  select md5(coalesce(string_agg(id::text || coalesce(trial_ends_at::text, '-') || self_signup::text, ',' order by id), '')) into before_c from public.clients;
  select md5(coalesce(string_agg(id::text || coalesce(license_type, '-') || coalesce(license_expires_at::text, '-'), ',' order by id), '')) into before_s from public.screens;

  --MIGRATION--

  -- test people and TVs waiting to be paired
  insert into auth.users (instance_id, id, aud, role, email, is_anonymous, created_at, updated_at) values
    ('00000000-0000-0000-0000-000000000000', o1, 'authenticated', 'authenticated', 'nt-o1@test.invalid', false, now(), now()),
    ('00000000-0000-0000-0000-000000000000', o2, 'authenticated', 'authenticated', 'nt-o2@test.invalid', false, now(), now()),
    ('00000000-0000-0000-0000-000000000000', o3, 'authenticated', 'authenticated', 'nt-o3@test.invalid', false, now(), now()),
    ('00000000-0000-0000-0000-000000000000', dev1, 'authenticated', 'authenticated', null, true, now(), now()),
    ('00000000-0000-0000-0000-000000000000', dev2, 'authenticated', 'authenticated', null, true, now(), now()),
    ('00000000-0000-0000-0000-000000000000', dev3, 'authenticated', 'authenticated', null, true, now(), now()),
    ('00000000-0000-0000-0000-000000000000', dev4, 'authenticated', 'authenticated', null, true, now(), now()),
    ('00000000-0000-0000-0000-000000000000', dev5, 'authenticated', 'authenticated', null, true, now(), now());
  insert into public.screens (device_user_id, claimed, name, pairing_code, hardware_id) values
    (dev1, false, 'TV1', 'NTAAA1', 'nt-hw-' || dev1), (dev2, false, 'TV2', 'NTAAA2', 'nt-hw-' || dev2),
    (dev3, false, 'TV3', 'NTAAA3', 'nt-hw-' || dev3), (dev4, false, 'TV4', 'NTAAA4', 'nt-hw-' || dev4);
  -- o2's email already used a trial before (the old one-trial-per-email record)
  insert into public.trial_signups (email, client_id, user_id) values ('nt-o2@test.invalid', null, null) on conflict do nothing;

  -- ---------- 1. master's + Add business
  perform set_config('request.jwt.claims', json_build_object('sub', master, 'role', 'authenticated', 'email', 'altun@proviewtech.co.uk')::text, true);
  perform set_config('request.jwt.claim.sub', master::text, true);
  execute 'set local role authenticated';
  j := public.add_business('NT Master Biz', 'NT Owner', 'nt-owner@test.invalid', null, 'secret123');
  cid := (j->>'client_id')::uuid;
  execute 'reset role';
  select trial_ends_at into te from public.clients where id = cid;
  r := r || format(E'%s master Add business: no trial (trial_ends_at %s), location %s\n',
    case when te is null and exists (select 1 from public.sites where client_id = cid) then 'PASS' else 'FAIL' end,
    coalesce(te::text, 'null'), (select count(*) from public.sites where client_id = cid));
  -- master pairs a TV to it: no licence
  perform set_config('request.jwt.claims', json_build_object('sub', master, 'role', 'authenticated', 'email', 'altun@proviewtech.co.uk')::text, true);
  execute 'set local role authenticated';
  s := public.claim_screen('NTAAA1', 'Master TV', cid);
  execute 'reset role';
  r := r || format(E'%s master-added business: paired TV has no licence (%s)\n', case when s.license_type is null then 'PASS' else 'FAIL' end, coalesce(s.license_type, 'none'));

  -- ---------- 2. self-signup ("Set up your business")
  perform set_config('request.jwt.claims', json_build_object('sub', o1, 'role', 'authenticated', 'email', 'nt-o1@test.invalid', 'is_anonymous', false)::text, true);
  perform set_config('request.jwt.claim.sub', o1::text, true);
  execute 'set local role authenticated';
  cid := public.create_my_business('NT Self Biz', '0700', null);
  j := public.whoami();
  s := public.claim_screen('NTAAA2', 'Self TV 1', cid);
  ok := true;
  begin s := public.claim_screen('NTAAA3', 'Self TV 2', cid); exception when others then ok := false; msg := sqlerrm; end;
  execute 'reset role';
  select trial_ends_at into te from public.clients where id = cid;
  r := r || format(E'%s self-signup: business created, no trial (trial_ends_at %s), Owner %s, location %s\n',
    case when te is null and exists (select 1 from public.client_members where client_id = cid and user_id = o1 and role = 'manager')
          and exists (select 1 from public.sites where client_id = cid) then 'PASS' else 'FAIL' end,
    coalesce(te::text, 'null'), exists (select 1 from public.client_members where client_id = cid and user_id = o1 and role = 'manager'),
    (select count(*) from public.sites where client_id = cid));
  r := r || format(E'%s self-signup whoami: trial_only %s, has_licence %s\n',
    case when (j->'clients'->0->>'trial_only')::boolean = false and (j->'clients'->0->>'has_licence')::boolean = false then 'PASS' else 'FAIL' end,
    j->'clients'->0->>'trial_only', j->'clients'->0->>'has_licence');
  r := r || format(E'%s self-signup: paired TVs get no licence (TV1 %s, TV2 %s)\n',
    case when ok and (select count(*) from public.screens where client_id = cid and license_type is null) = 2 then 'PASS' else 'FAIL' end,
    (select coalesce(license_type, 'none') from public.screens where pairing_code is null and device_user_id = dev2),
    case when ok then (select coalesce(license_type, 'none') from public.screens where device_user_id = dev3) else 'refused: ' || msg end);

  -- an email that already had a trial can still set up a business (no licence)
  perform set_config('request.jwt.claims', json_build_object('sub', o2, 'role', 'authenticated', 'email', 'nt-o2@test.invalid', 'is_anonymous', false)::text, true);
  perform set_config('request.jwt.claim.sub', o2::text, true);
  execute 'set local role authenticated';
  ok := true; x := null;
  begin x := public.create_my_business('NT Again Biz', null, null); exception when others then ok := false; msg := sqlerrm; end;
  execute 'reset role';
  r := r || format(E'%s self-signup with an email that had a trial: allowed, no trial %s\n',
    case when ok and (select trial_ends_at from public.clients where id = x) is null then 'PASS' else 'FAIL' end, coalesce(case when not ok then msg end, ''));

  -- ---------- 3. older / direct paths: insert into clients with a trial date
  insert into public.clients (name, self_signup, trial_ends_at) values ('NT Direct', true, now() + interval '3 days') returning id into x;
  r := r || format(E'%s direct insert into clients with trial_ends_at: cleared (%s)\n',
    case when (select trial_ends_at from public.clients where id = x) is null then 'PASS' else 'FAIL' end,
    coalesce((select trial_ends_at::text from public.clients where id = x), 'null'));

  -- ---------- 4. new location: Signage has one location per business (added with it, no licence); a second is refused
  ok := true;
  begin insert into public.sites (client_id, name) values (x, 'Second'); exception when others then ok := false; msg := sqlerrm; end;
  r := r || format(E'%s new location: the business''s location came with it (%s), a second is refused (%s)\n',
    case when not ok and (select count(*) from public.sites where client_id = x) = 1 then 'PASS' else 'FAIL' end,
    (select count(*) from public.sites where client_id = x), coalesce(msg, 'allowed'));

  -- ---------- 5. a business on its trial today keeps it: TV gets the rest of the trial, 1-screen limit stays
  insert into public.clients (id, name, self_signup) values (ctr, 'NT Trial Biz', true);
  update public.clients set trial_ends_at = now() + interval '2 days' where id = ctr;   -- as a pre-042 sign-up
  insert into public.client_members (client_id, user_id, role) values (ctr, o3, 'manager');
  perform set_config('request.jwt.claims', json_build_object('sub', o3, 'role', 'authenticated', 'email', 'nt-o3@test.invalid', 'is_anonymous', false)::text, true);
  perform set_config('request.jwt.claim.sub', o3::text, true);
  execute 'set local role authenticated';
  s := public.claim_screen('NTAAA4', 'Trial TV', ctr);
  ok := true;
  insert into public.screens (device_user_id, claimed, name, pairing_code, hardware_id) values (dev5, false, 'TV5', 'NTAAA5', 'nt-hw5');
  begin perform public.claim_screen('NTAAA5', 'Trial TV 2', ctr); exception when others then ok := false; msg := sqlerrm; end;
  j := public.whoami();
  execute 'reset role';
  r := r || format(E'%s existing trial business: TV gets trial7 to the business''s trial end (%s / %s)\n',
    case when s.license_type = 'trial7' and s.license_expires_at = (select trial_ends_at from public.clients where id = ctr) then 'PASS' else 'FAIL' end,
    coalesce(s.license_type, 'none'), s.license_expires_at);
  r := r || format(E'%s existing trial business: 2nd TV still refused (%s), whoami trial_only %s\n',
    case when not ok and msg like 'Your free trial includes 1 screen%' and (j->'clients'->0->>'trial_only')::boolean then 'PASS' else 'FAIL' end,
    coalesce(msg, 'allowed'), j->'clients'->0->>'trial_only');

  -- ---------- 6. a non-master is still refused
  perform set_config('request.jwt.claims', json_build_object('sub', o1, 'role', 'authenticated', 'email', 'nt-o1@test.invalid', 'is_anonymous', false)::text, true);
  perform set_config('request.jwt.claim.sub', o1::text, true);
  execute 'set local role authenticated';
  ok := true;
  begin perform public.add_business('NT Sneaky', 'X', 'nt-x@test.invalid', null, 'secret123'); exception when others then ok := false; msg := sqlerrm; end;
  execute 'reset role';
  r := r || format(E'%s non-master add_business refused (%s)\n', case when not ok then 'PASS' else 'FAIL' end, coalesce(msg, 'allowed'));

  -- ---------- 7. existing businesses and licences unchanged
  select md5(coalesce(string_agg(id::text || coalesce(trial_ends_at::text, '-') || self_signup::text, ',' order by id), '')) into after_c
    from public.clients where name not like 'NT %';
  select md5(coalesce(string_agg(id::text || coalesce(license_type, '-') || coalesce(license_expires_at::text, '-'), ',' order by id), '')) into after_s
    from public.screens where not (coalesce(device_user_id, '00000000-0000-0000-0000-000000000000') = any (array[dev1, dev2, dev3, dev4, dev5]));
  r := r || format(E'%s existing businesses unchanged (%s)\n', case when before_c = after_c then 'PASS' else 'FAIL' end, (select count(*) from public.clients where trial_ends_at > now() and name not like 'NT %') || ' still on a trial');
  r := r || format(E'%s existing TV licences unchanged\n', case when before_s = after_s then 'PASS' else 'FAIL' end);

  raise exception E'ROLLED BACK. Results:\n%', r;
end $t$;
