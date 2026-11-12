-- Live check of 047 (hub_call 'link' / 'unlink'). One DO block that ends with RAISE EXCEPTION, so everything is rolled
-- back: the error message IS the PASS/FAIL report. Before 047 is applied, replace the --MIGRATION-- line with:
--   execute $mig$ <contents of 047_locations_link.sql> $mig$;
-- The hub token is swapped for a test token inside the transaction (rolled back with everything else).
do $t$
declare
  r text := '';
  tok text := 'll-test-token-' || gen_random_uuid();
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid(); dev uuid := gen_random_uuid();
  ca uuid; cb uuid; sa uuid; sb uuid; sb2 uuid; pb uuid; pa uuid; mb uuid; tv uuid; n_before int; n_after int;
  j jsonb; j2 jsonb; lst jsonb; ok boolean; msg text; nid uuid; x record; cnt int;
begin
  update hub_private.config set token_sha256 = encode(extensions.digest(tok, 'sha256'), 'hex') where id = 1;
  n_before := jsonb_array_length(public.hub_call(tok, 'list', '{}')->'units');

  --MIGRATION--

  n_after := jsonb_array_length(public.hub_call(tok, 'list', '{}')->'units');
  r := r || format(E'%s list unchanged after the migration (%s units)\n', case when n_before = n_after then 'PASS' else 'FAIL' end, n_after);
  r := r || format(E'%s old hub_call kept as hub_private.hub_call_pre_link, not callable by anon/authenticated\n',
    case when to_regprocedure('hub_private.hub_call_pre_link(text,text,jsonb)') is not null
          and not has_function_privilege('anon', 'hub_private.hub_call_pre_link(text,text,jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'hub_private.link_clients(uuid,uuid)', 'execute') then 'PASS' else 'FAIL' end);
  begin perform public.hub_call('wrong', 'link', '{}'); ok := false; exception when others then ok := sqlerrm = 'not authorised'; end;
  r := r || format(E'%s link with a wrong token: refused\n', case when ok then 'PASS' else 'FAIL' end);
  r := r || format(E'%s owners/master can no longer insert or delete a location (no policies, no grants)\n',
    case when not exists (select 1 from pg_policies where tablename = 'sites' and cmd in ('INSERT', 'DELETE'))
          and not has_table_privilege('authenticated', 'public.sites', 'insert')
          and not has_table_privilege('authenticated', 'public.sites', 'delete') then 'PASS' else 'FAIL' end);

  -- test data: two businesses (each gets its location from its trigger), people, content, a TV in B
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
    (u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'll-a-' || u1 || '@example.com', now(), now()),
    (u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'll-b-' || u2 || '@example.com', now(), now()),
    (u3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'll-c-' || u3 || '@example.com', now(), now());
  insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at)
  values (dev, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, now(), now());
  insert into public.clients (name) values ('LL Cafe Alpha') returning id into ca;
  insert into public.clients (name) values ('LL Cafe Beta') returning id into cb;
  select id into sa from public.sites where client_id = ca;
  select id into sb from public.sites where client_id = cb;
  insert into public.client_members (client_id, user_id, role) values (ca, u1, 'manager'), (cb, u2, 'manager'), (cb, u1, 'editor'), (cb, u3, 'editor');
  insert into public.playlists (client_id, name, slides) values (cb, 'Beta menu', '[]') returning id into pb;
  insert into public.playlists (client_id, name, slides) values (ca, 'Alpha menu', '[]') returning id into pa;
  insert into public.media (client_id, name, path, kind) values (cb, 'beta.jpg', cb || '/ll-test-' || gen_random_uuid() || '.jpg', 'image') returning id into mb;
  insert into public.screens (device_user_id, client_id, claimed, name, site_id, default_playlist_id, license_type)
  values (dev, cb, true, 'Beta TV', sb, pb, 'm12') returning id into tv;
  insert into public.overrides (scope, client_id, message, active) values ('client', cb, 'Beta closed Monday', true);

  -- 1. link B into A
  j := public.hub_call(tok, 'link', jsonb_build_object('into', ca, 'from', cb));
  r := r || format(E'%s link answer: ok, account A, moved_sites [loc/B site] (%s)\n',
    case when (j->>'ok')::boolean and j->>'account' = ca::text and j->'moved_sites' = jsonb_build_array('loc/' || sb)
          and not (j->>'already')::boolean then 'PASS' else 'FAIL' end, j);
  r := r || format(E'%s B''s business row is gone; its location is now in A (A has %s locations)\n',
    case when not exists (select 1 from public.clients where id = cb) and (select client_id from public.sites where id = sb) = ca
          then 'PASS' else 'FAIL' end, (select count(*) from public.sites where client_id = ca));
  select * into x from public.screens where id = tv;
  r := r || format(E'%s TV moved with its location, keeps location, playlist and licence (%s / %s / %s / %s)\n',
    case when x.client_id = ca and x.site_id = sb and x.default_playlist_id = pb and x.license_type = 'm12' then 'PASS' else 'FAIL' end,
    x.client_id = ca, x.site_id = sb, x.default_playlist_id = pb, x.license_type);
  r := r || format(E'%s B''s "every location" playlist now only for B''s location; A''s for A''s\n',
    case when (select client_id = ca and site_ids = array[sb] from public.playlists where id = pb)
          and (select site_ids = array[sa] from public.playlists where id = pa) then 'PASS' else 'FAIL' end);
  r := r || format(E'%s media moved to A, its folder now readable for A\n',
    case when (select client_id = ca from public.media where id = mb) and public.folder_has_client(cb::text, ca) then 'PASS' else 'FAIL' end);
  r := r || format(E'%s B''s business-wide message became a message for B''s location\n',
    case when exists (select 1 from public.overrides where client_id = ca and scope = 'site' and site_id = sb and message = 'Beta closed Monday')
          and not exists (select 1 from public.overrides where client_id = ca and scope = 'client') then 'PASS' else 'FAIL' end);
  r := r || format(E'%s members: B''s manager joined A as manager; u1 kept the higher role (manager); u3 editor of B''s location only\n',
    case when (select role from public.client_members where client_id = ca and user_id = u2) = 'manager'
          and (select role from public.client_members where client_id = ca and user_id = u1) = 'manager'
          and (select role = 'editor' and site_ids = array[sb] from public.client_members where client_id = ca and user_id = u3) then 'PASS' else 'FAIL' end);
  lst := public.hub_call(tok, 'list', '{}');
  r := r || format(E'%s list: B''s location unit now under A, B''s account gone\n',
    case when exists (select 1 from jsonb_array_elements(lst->'units') u where u->>'id' = 'loc/' || sb and u->>'account_id' = ca::text)
          and not exists (select 1 from jsonb_array_elements(lst->'accounts') a where a->>'id' = cb::text) then 'PASS' else 'FAIL' end);

  -- 2. idempotent; refusals
  j2 := public.hub_call(tok, 'link', jsonb_build_object('into', ca, 'from', cb));
  r := r || format(E'%s link again: ok, already (%s)\n', case when (j2->>'ok')::boolean and (j2->>'already')::boolean
          and j2->'moved_sites' = jsonb_build_array('loc/' || sb) then 'PASS' else 'FAIL' end, j2);
  begin perform public.hub_call(tok, 'link', jsonb_build_object('into', ca, 'from', ca)); msg := null; exception when others then msg := sqlerrm; end;
  r := r || format(E'%s link to itself refused (%s)\n', case when msg like '%itself%' then 'PASS' else 'FAIL' end, msg);
  begin perform public.hub_call(tok, 'link', jsonb_build_object('into', ca, 'from', gen_random_uuid())); msg := null; exception when others then msg := sqlerrm; end;
  r := r || format(E'%s link from a missing account refused (%s)\n', case when msg like 'Account not found:%' then 'PASS' else 'FAIL' end, msg);
  begin perform public.hub_call(tok, 'link', jsonb_build_object('into', gen_random_uuid(), 'from', ca)); msg := null; exception when others then msg := sqlerrm; end;
  r := r || format(E'%s link into a missing account refused (%s)\n', case when msg like 'Account not found:%' then 'PASS' else 'FAIL' end, msg);

  -- 3. unlink B's location again
  j := public.hub_call(tok, 'unlink', jsonb_build_object('account', ca, 'site', 'loc/' || sb));
  nid := (j->>'account')::uuid;
  r := r || format(E'%s unlink answer: ok, new account, site loc/B (%s)\n',
    case when (j->>'ok')::boolean and nid is not null and nid <> ca and j->>'site' = 'loc/' || sb then 'PASS' else 'FAIL' end, j);
  r := r || format(E'%s new business named after the location, holding only that location\n',
    case when (select name from public.clients where id = nid) = 'LL Cafe Beta'
          and (select array_agg(id) from public.sites where client_id = nid) = array[sb] then 'PASS' else 'FAIL' end);
  select * into x from public.screens where id = tv;
  r := r || format(E'%s TV, its playlist and media went with it (%s / %s / %s)\n',
    case when x.client_id = nid and x.site_id = sb and x.default_playlist_id = pb
          and (select client_id from public.playlists where id = pb) = nid and (select client_id from public.media where id = mb) = nid
          then 'PASS' else 'FAIL' end, x.client_id = nid, x.site_id = sb, x.default_playlist_id = pb);
  r := r || format(E'%s members who could see it were copied (managers u1 and u2, editor u3); A keeps them\n',
    case when (select count(*) from public.client_members where client_id = nid and user_id in (u1, u2, u3)) = 3
          and (select count(*) from public.client_members where client_id = ca and user_id in (u1, u2, u3)) = 3 then 'PASS' else 'FAIL' end);
  j2 := public.hub_call(tok, 'unlink', jsonb_build_object('account', ca, 'site', sb::text));
  r := r || format(E'%s unlink again (bare site id): ok, already, same new account (%s)\n',
    case when (j2->>'already')::boolean and j2->>'account' = nid::text then 'PASS' else 'FAIL' end, j2);
  begin perform public.hub_call(tok, 'unlink', jsonb_build_object('account', ca, 'site', 'loc/' || sa)); msg := null; exception when others then msg := sqlerrm; end;
  r := r || format(E'%s unlink of the only location refused (%s)\n', case when msg like '%only that one location%' then 'PASS' else 'FAIL' end, msg);
  begin perform public.hub_call(tok, 'unlink', jsonb_build_object('account', ca, 'site', 'loc/' || gen_random_uuid())); msg := null; exception when others then msg := sqlerrm; end;
  r := r || format(E'%s unlink of a missing location refused (%s)\n', case when msg like 'Location not found:%' then 'PASS' else 'FAIL' end, msg);

  -- 4. a TV changing business outside the hub still drops its old location (guard unchanged outside link / unlink)
  insert into public.clients (name) values ('LL Gamma') returning id into cb;
  update public.screens set client_id = cb where id = tv;
  r := r || format(E'%s outside link/unlink a TV moved to another business still drops its old location (as before 047)\n',
    case when (select site_id from public.screens where id = tv) is distinct from sb then 'PASS' else 'FAIL' end);

  raise exception E'047 test (rolled back):\n%', r;
end $t$;
