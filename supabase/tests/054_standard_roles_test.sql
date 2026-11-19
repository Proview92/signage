-- Test for 054_standard_roles.sql. Paste into the SQL editor of signage (zbuyafrdhbgqyaepiajm) AFTER the migration.
-- Throw-away rows (zz054 / example.invalid); it ALWAYS ends with an exception listing PASS / FAIL, which rolls back.
do $t$
declare out text[] := '{}'; tok text := 'zz054-hub-token'; c uuid; ua uuid := gen_random_uuid(); um uuid := gen_random_uuid();
        us uuid := gen_random_uuid(); j jsonb; r jsonb; n int; ok boolean; rl text;
begin
  update hub_private.config set token_sha256 = encode(extensions.digest(tok, 'sha256'), 'hex') where id = 1;
  -- the real logins were renamed with the same access
  select count(*) into n from public.client_members where role not in ('admin', 'manager', 'staff');
  out := out || ((case when n = 0 then 'PASS' else 'FAIL' end) || ' every login has a standard role (' || n || ' left over)');
  select json_object_agg(role, k) into r from (select role, count(*) k from public.client_members group by role) x;
  out := out || ('INFO roles now: ' || coalesce(r::text, '{}'));
  begin insert into public.client_members(client_id, user_id, role) select id, gen_random_uuid(), 'editor' from public.clients limit 1; out := out || 'FAIL old role editor accepted'::text;
  exception when others then out := out || 'PASS old role names refused by the table'::text; end;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname in ('public', 'hub_private') and p.prosrc ~ '''(site_manager|editor)''|"(site_manager|editor)"';
  out := out || ((case when n = 0 then 'PASS' else 'FAIL' end) || ' no function uses site_manager / editor (' || n || ')');
  select count(*) into n from pg_policies where coalesce(qual, '') || coalesce(with_check, '') ~ 'site_manager|editor';
  out := out || ((case when n = 0 then 'PASS' else 'FAIL' end) || ' no policy uses site_manager / editor (' || n || ')');
  select count(*) into n from pg_policies where policyname = 'members_manage' and qual ~ '''admin''';
  out := out || ((case when n = 1 then 'PASS' else 'FAIL' end) || ' members_manage is for admins');

  -- fixtures: a business with an admin, a manager and a staff login
  insert into public.clients(name) values ('zz054 Alpha') returning id into c;
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, is_anonymous) values
    (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz054-adm@example.invalid', '', now(), now(), now(), false),
    (um, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz054-mgr@example.invalid', '', now(), now(), now(), false),
    (us, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz054-stf@example.invalid', '', now(), now(), now(), false);
  insert into public.client_members(client_id, user_id, role) values (c, ua, 'admin'), (c, um, 'manager'), (c, us, 'staff');

  -- an admin does what the old manager (Owner / Admin) did; the new manager (old site_manager) can't
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'email', 'zz054-adm@example.invalid', 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('request.jwt.claim.sub', ua::text, true);
  execute 'set local role authenticated';
  ok := public.is_member(c, array['admin']);
  out := out || ((case when ok then 'PASS' else 'FAIL' end) || ' admin is the business''s admin');
  begin perform public.set_require_approval(c, true); out := out || 'PASS an admin changes business settings (was owner / admin only)'::text;
  exception when others then out := out || ('FAIL admin set_require_approval: ' || sqlerrm); end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'email', 'zz054-mgr@example.invalid', 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('request.jwt.claim.sub', um::text, true);
  execute 'set local role authenticated';
  begin perform public.set_require_approval(c, false); out := out || 'FAIL a manager changed an admin-only setting'::text;
  exception when others then out := out || ('PASS a manager can''t change admin-only settings: ' || sqlerrm); end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true); perform set_config('request.jwt.claim.sub', '', true);

  -- the licence portal: role list and New business
  j := hub_users(tok, 'list', jsonb_build_object('account', c::text));
  out := out || ((case when (j->'roles')::text !~ 'Owner|site_manager|editor' and (j->'roles')::text ~ '"admin"' and (j->'roles')::text ~ '"staff"' then 'PASS' else 'FAIL' end) || ' portal role list: ' || coalesce((j->'roles')::text, j::text));
  begin
    j := hub_call(tok, 'add_business', jsonb_build_object('business', 'zz054 Beta', 'name', 'Bea Test', 'email', 'zz054-bea@example.invalid', 'password', 'longpassword54'));
    select m.role into rl from public.client_members m join auth.users u on u.id = m.user_id where u.email = 'zz054-bea@example.invalid';
    out := out || ((case when rl = 'admin' then 'PASS' else 'FAIL' end) || ' New business makes its login an Admin (' || coalesce(rl, 'none') || ')');
  exception when others then out := out || ('FAIL add_business: ' || sqlerrm); end;

  -- sign-in check
  r := public.sso_entitled('zz054-stranger@example.invalid');
  out := out || ((case when r->>'reason' = 'No Proview Signage account for this email.' then 'PASS' else 'FAIL' end) || ' stranger: ' || coalesce(r->>'reason', r::text));
  r := public.sso_entitled('zz054-stf@example.invalid');
  out := out || ((case when (r->>'ok')::boolean then 'PASS' else 'FAIL' end) || ' staff login is let in');
  r := public.sso_entitled((select u.email from public.profiles p join auth.users u on u.id = p.id where p.is_admin limit 1));
  out := out || ((case when (r->>'ok')::boolean then 'PASS' else 'FAIL' end) || ' the master is let in');

  raise exception E'054 SIGNAGE TEST RESULT (rolled back): %/% PASS\n%',
    (select count(*) from unnest(out) x where x like 'PASS%'), (select count(*) from unnest(out) x where x not like 'INFO%'), array_to_string(out, E'\n');
end $t$;
