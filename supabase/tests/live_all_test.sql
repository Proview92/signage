-- Live check of the main database rules (locations, roles, pause, sign-in, TV device calls).
-- Everything (test users @test.invalid, businesses, locations, playlists, TVs) is created inside one DO block
-- that ends with RAISE EXCEPTION, so it is all rolled back: the error message IS the PASS/FAIL report.

create or replace function pg_temp.act(uid uuid, anon boolean default false) returns void language plpgsql as $f$
begin
  if uid is null then
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    execute 'reset role';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'is_anonymous', anon,
      'email', (select email from auth.users where id = uid))::text, true);
    perform set_config('request.jwt.claim.sub', uid::text, true);
    execute 'set local role authenticated';
  end if;
end $f$;

do $t$
declare
  r text := '';
  master uuid := (select id from auth.users where email = 'altun@proviewtech.co.uk');
  o1 uuid := gen_random_uuid(); mgr uuid := gen_random_uuid(); stf uuid := gen_random_uuid(); o2 uuid := gen_random_uuid();
  nb uuid := gen_random_uuid(); dev uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  sA uuid := gen_random_uuid(); sB uuid := gen_random_uuid(); sZ uuid := gen_random_uuid();
  pS uuid := gen_random_uuid(); scr uuid := gen_random_uuid();
  n int; ok boolean; msg text; j jsonb; x uuid;
begin
  insert into auth.users (instance_id, id, aud, role, email, is_anonymous, created_at, updated_at) values
    ('00000000-0000-0000-0000-000000000000', o1, 'authenticated', 'authenticated', 'o1-all@test.invalid', false, now(), now()),
    ('00000000-0000-0000-0000-000000000000', mgr, 'authenticated', 'authenticated', 'mgr-all@test.invalid', false, now(), now()),
    ('00000000-0000-0000-0000-000000000000', stf, 'authenticated', 'authenticated', 'stf-all@test.invalid', false, now(), now()),
    ('00000000-0000-0000-0000-000000000000', o2, 'authenticated', 'authenticated', 'o2-all@test.invalid', false, now(), now()),
    ('00000000-0000-0000-0000-000000000000', nb, 'authenticated', 'authenticated', 'nb-all@test.invalid', false, now(), now()),
    ('00000000-0000-0000-0000-000000000000', dev, 'authenticated', 'authenticated', null, true, now(), now());
  insert into clients (id, name) values (c1, 'TESTALL Burger'), (c2, 'TESTALL Other');
  insert into sites (id, client_id, name) values (sA, c1, 'A'), (sB, c1, 'B'), (sZ, c2, 'Z');
  insert into client_members (client_id, user_id, role, site_ids, features) values
    (c1, o1, 'manager', null, '{}'), (c1, mgr, 'site_manager', array[sA], '{}'),
    (c1, stf, 'editor', array[sB], '{}'), (c2, o2, 'manager', null, '{}');
  insert into playlists (id, client_id, name, slides, settings) values (pS, c1, 'shared', '[]', '{}');
  insert into screens (id, device_user_id, claimed, name, client_id, site_id, license_type, screenshot_requested_at)
    values (scr, dev, true, 'TV', c1, sA, 'lifetime', now());

  -- ---------- adding a location (the 033 fix)
  perform pg_temp.act(master);
  begin insert into sites (client_id, name) values (c1, 'by master') returning id into x; ok := x is not null; exception when others then ok := false; msg := sqlerrm; end;
  r := r || format(E'%s master adds a location %s\n', case when ok then 'PASS' else 'FAIL' end, coalesce(case when not ok then msg end, ''));
  select count(*) into n from sites where client_id in (c1, c2);
  r := r || format(E'%s master sees every location (%s/4)\n', case when n = 4 then 'PASS' else 'FAIL' end, n);
  perform pg_temp.act(null);

  perform pg_temp.act(o1);
  msg := null;
  begin insert into sites (client_id, name) values (c1, 'by owner') returning id into x; ok := x is not null; exception when others then ok := false; msg := sqlerrm; end;
  r := r || format(E'%s owner adds a location %s\n', case when ok then 'PASS' else 'FAIL' end, coalesce(msg, ''));
  select count(*) into n from sites where client_id in (c1, c2);
  r := r || format(E'%s owner sees only own business locations (%s/4)\n', case when n = 4 then 'PASS' else 'FAIL' end, n);
  begin insert into sites (client_id, name) values (c2, 'into other') returning id into x; ok := false; exception when others then ok := true; end;
  r := r || format(E'%s owner cannot add a location to another business\n', case when ok then 'PASS' else 'FAIL' end);
  select count(*) into n from public.list_team(c1);
  r := r || format(E'%s owner lists team (%s people)\n', case when n = 3 then 'PASS' else 'FAIL' end, n);
  j := public.whoami();
  r := r || format(E'%s whoami for owner shows 1 business\n', case when jsonb_array_length(j->'clients') = 1 then 'PASS' else 'FAIL' end);
  begin perform public.set_playlist_pause(pS, 'infinity'); ok := exists (select 1 from playlist_pauses where playlist_id = pS); exception when others then ok := false; msg := sqlerrm; end;
  r := r || format(E'%s owner stops a playlist %s\n', case when ok then 'PASS' else 'FAIL' end, case when not ok then msg else '' end);
  begin perform public.set_playlist_pause(pS, null); ok := not exists (select 1 from playlist_pauses where playlist_id = pS); exception when others then ok := false; end;
  r := r || format(E'%s owner plays it again\n', case when ok then 'PASS' else 'FAIL' end);
  begin perform public.publish_screen(scr); ok := true; exception when others then ok := false; msg := sqlerrm; end;
  r := r || format(E'%s owner publishes a TV %s\n', case when ok then 'PASS' else 'FAIL' end, case when not ok then msg else '' end);
  perform pg_temp.act(null);

  perform pg_temp.act(mgr);
  select count(*) into n from sites where client_id in (c1, c2);
  r := r || format(E'%s location-limited manager sees only their location (%s/1)\n', case when n = 1 then 'PASS' else 'FAIL' end, n);
  begin insert into sites (client_id, name) values (c1, 'by mgr') returning id into x; ok := false; exception when others then ok := true; end;
  r := r || format(E'%s location-limited manager cannot add a location\n', case when ok then 'PASS' else 'FAIL' end);
  begin perform public.set_playlist_pause(pS, 'infinity'); ok := false; exception when others then ok := true; end;
  r := r || format(E'%s location-limited manager cannot stop a shared playlist\n', case when ok then 'PASS' else 'FAIL' end);
  perform pg_temp.act(null);

  perform pg_temp.act(stf);
  select count(*) into n from screens where id = scr;
  r := r || format(E'%s staff of location B cannot see the TV at location A (%s)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);
  perform pg_temp.act(null);

  perform pg_temp.act(o2);
  select count(*) into n from sites where client_id = c1;
  r := r || format(E'%s other business sees none of these locations (%s)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from screens where id = scr;
  r := r || format(E'%s other business cannot see the TV (%s)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);
  begin perform public.set_playlist_pause(pS, 'infinity'); ok := false; exception when others then ok := true; end;
  r := r || format(E'%s other business cannot stop the playlist\n', case when ok then 'PASS' else 'FAIL' end);
  perform pg_temp.act(null);

  -- ---------- self sign-up trial
  perform pg_temp.act(nb);
  begin x := public.create_my_business('TESTALL Kebab', null, 'Main'); ok := x is not null; exception when others then ok := false; msg := sqlerrm; end;
  r := r || format(E'%s new person creates a trial business %s\n', case when ok then 'PASS' else 'FAIL' end, case when not ok then msg else '' end);
  select count(*) into n from sites where client_id = x;
  r := r || format(E'%s ...with its first location, visible to them (%s)\n', case when n = 1 then 'PASS' else 'FAIL' end, n);
  begin insert into sites (client_id, name) values (x, 'second') returning id into x; ok := true; exception when others then ok := false; msg := sqlerrm; end;
  r := r || format(E'%s ...and can add another location %s\n', case when ok then 'PASS' else 'FAIL' end, case when not ok then msg else '' end);
  perform pg_temp.act(null);

  -- ---------- sign-in prompt
  execute 'set local role anon';
  ok := public.email_has_account('o1-all@test.invalid') and not public.email_has_account('nobody-xyz@test.invalid');
  r := r || format(E'%s sign-in knows which emails have an account\n', case when ok then 'PASS' else 'FAIL' end);
  execute 'reset role';

  -- ---------- TV device
  perform pg_temp.act(dev, true);
  begin perform public.screen_heartbeat('{"app":"test"}'::jsonb); ok := true; exception when others then ok := false; msg := sqlerrm; end;
  r := r || format(E'%s TV heartbeat %s\n', case when ok then 'PASS' else 'FAIL' end, case when not ok then msg else '' end);
  begin perform public.screenshot_done(true, null); ok := true; exception when others then ok := false; msg := sqlerrm; end;
  perform pg_temp.act(null);
  select ok and screenshot_requested_at is null and screenshot_at is not null into ok from screens where id = scr;
  r := r || format(E'%s TV reports a screenshot taken %s\n', case when ok then 'PASS' else 'FAIL' end, case when not ok then coalesce(msg, '') else '' end);

  raise exception E'TEST RESULTS (rolled back)\n%', r;
end $t$;
