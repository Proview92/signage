-- Live test for 031_content_sites. Paste into the Supabase SQL editor and run.
-- Everything (test users @test.invalid, businesses, sites, playlists, media, files, TVs) is created inside one
-- DO block that ends with RAISE EXCEPTION, so it is all rolled back: the error message IS the PASS/FAIL report.
-- Afterwards: select count(*) from auth.users where email like '%@test.invalid';  -- expect 0

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
  master uuid := 'bcaa724e-f587-4d77-b24b-a38e5cd247b0';
  o1 uuid := gen_random_uuid(); ma uuid := gen_random_uuid(); sb uuid := gen_random_uuid(); o2 uuid := gen_random_uuid();
  dev uuid := gen_random_uuid(); devA uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  sA uuid := gen_random_uuid(); sB uuid := gen_random_uuid(); sC uuid := gen_random_uuid(); sZ uuid := gen_random_uuid();
  pS uuid := gen_random_uuid(); pA uuid := gen_random_uuid(); pB uuid := gen_random_uuid(); pAB uuid := gen_random_uuid(); pZ uuid := gen_random_uuid();
  mS uuid := gen_random_uuid(); mA uuid := gen_random_uuid(); mB uuid := gen_random_uuid();
  scrA uuid := gen_random_uuid(); scrB uuid := gen_random_uuid();
  allp uuid[]; n int; x uuid; arr uuid[]; ok boolean; msg text;
begin
  -- ---------------- setup (as postgres)
  insert into auth.users (instance_id, id, aud, role, email, is_anonymous, created_at, updated_at) values
    ('00000000-0000-0000-0000-000000000000', o1, 'authenticated', 'authenticated', 'o1-031@test.invalid', false, now(), now()),
    ('00000000-0000-0000-0000-000000000000', ma, 'authenticated', 'authenticated', 'ma-031@test.invalid', false, now(), now()),
    ('00000000-0000-0000-0000-000000000000', sb, 'authenticated', 'authenticated', 'sb-031@test.invalid', false, now(), now()),
    ('00000000-0000-0000-0000-000000000000', o2, 'authenticated', 'authenticated', 'o2-031@test.invalid', false, now(), now()),
    ('00000000-0000-0000-0000-000000000000', dev, 'authenticated', 'authenticated', null, true, now(), now()),
    ('00000000-0000-0000-0000-000000000000', devA, 'authenticated', 'authenticated', null, true, now(), now());
  insert into clients (id, name) values (c1, 'TEST031 Burger'), (c2, 'TEST031 Other');
  insert into sites (id, client_id, name) values (sA, c1, 'A'), (sB, c1, 'B'), (sC, c1, 'C'), (sZ, c2, 'Z');
  insert into client_members (client_id, user_id, role, site_ids, features) values
    (c1, o1, 'manager', null, '{}'), (c1, ma, 'site_manager', array[sA], '{}'),
    (c1, sb, 'editor', array[sB], '{"playlists":false}'), (c2, o2, 'manager', null, '{}');
  insert into playlists (id, client_id, name, slides, settings, site_ids) values
    (pS, c1, 'shared', '[]', '{}', null), (pA, c1, 'A', '[]', '{}', array[sA]), (pB, c1, 'B', '[]', '{}', array[sB]),
    (pAB, c1, 'AB', '[]', '{}', array[sA, sB]), (pZ, c2, 'Z', '[]', '{}', null);
  allp := array[pS, pA, pB, pAB, pZ];
  insert into media (id, client_id, name, path, kind, site_ids) values
    (mS, c1, 'mS', c1 || '/t031-s.jpg', 'image', null), (mA, c1, 'mA', c1 || '/t031-a.jpg', 'image', array[sA]),
    (mB, c1, 'mB', c1 || '/t031-b.jpg', 'image', array[sB]);
  insert into storage.objects (bucket_id, name) values ('media', c1 || '/t031-s.jpg'), ('media', c1 || '/t031-a.jpg'), ('media', c1 || '/t031-b.jpg');
  insert into screens (id, device_user_id, claimed, name, client_id, site_id, license_type) values
    (scrA, devA, true, 'TV A', c1, sA, 'lifetime'), (scrB, dev, true, 'TV B', c1, sB, 'lifetime');
  insert into playlist_pauses (playlist_id, client_id, until) values (pB, c1, 'infinity'), (pS, c1, 'infinity');

  -- ---------------- master
  perform pg_temp.act(master);
  select count(*) into n from playlists where id = any(allp);
  r := r || format(E'%s master sees all 5 test playlists (%s)\n', case when n = 5 then 'PASS' else 'FAIL' end, n);
  perform pg_temp.act(null);

  -- ---------------- owner 1
  perform pg_temp.act(o1);
  select count(*) into n from playlists where id = any(allp);
  r := r || format(E'%s owner sees own business only, all sites (%s/4)\n', case when n = 4 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from media where client_id = c1;
  r := r || format(E'%s owner sees all 3 media\n', case when n = 3 then 'PASS' else 'FAIL' end);
  insert into playlists (client_id, name, slides, settings) values (c1, 'owner new', '[]', '{}') returning site_ids into arr;
  r := r || format(E'%s owner-created playlist stays shared (NULL): %s\n', case when arr is null then 'PASS' else 'FAIL' end, arr);
  update playlists set site_ids = array[sA, sB, sB] where id = pA returning site_ids into arr;
  r := r || format(E'%s owner can set sites (deduped: %s)\n', case when cardinality(arr) = 2 then 'PASS' else 'FAIL' end, cardinality(arr));
  update playlists set site_ids = array[sA] where id = pA;
  begin
    update playlists set site_ids = array[sZ] where id = pA;
    r := r || E'FAIL owner tagged a playlist with another business''s site\n';
  exception when others then r := r || format(E'PASS owner blocked from other business''s site (%s)\n', sqlerrm); end;
  perform pg_temp.act(null);

  -- ---------------- manager limited to site A
  perform pg_temp.act(ma);
  select count(*) into n from playlists where id = any(allp);
  ok := n = 3 and exists (select 1 from playlists where id = pS) and exists (select 1 from playlists where id = pAB) and not exists (select 1 from playlists where id = pB);
  r := r || format(E'%s site-A manager sees shared + A + AB, not B (%s)\n', case when ok then 'PASS' else 'FAIL' end, n);
  select count(*) into n from media where client_id = c1;
  ok := n = 2 and not exists (select 1 from media where id = mB);
  r := r || format(E'%s site-A manager media: shared + A only (%s)\n', case when ok then 'PASS' else 'FAIL' end, n);
  select count(*) into n from storage.objects where bucket_id = 'media' and name like c1 || '/t031-%';
  ok := n = 2 and not exists (select 1 from storage.objects where bucket_id = 'media' and name = c1 || '/t031-b.jpg');
  r := r || format(E'%s site-A manager storage files: shared + A only (%s)\n', case when ok then 'PASS' else 'FAIL' end, n);
  insert into playlists (client_id, name, slides, settings) values (c1, 'ma new', '[]', '{}') returning site_ids into arr;
  r := r || format(E'%s new playlist auto-tagged with their sites (%s)\n', case when arr = array[sA] then 'PASS' else 'FAIL' end, arr);
  insert into media (client_id, name, path, kind) values (c1, 'ma media', c1 || '/t031-new.jpg', 'image') returning site_ids into arr;
  r := r || format(E'%s new media auto-tagged with their sites (%s)\n', case when arr = array[sA] then 'PASS' else 'FAIL' end, arr);
  begin
    insert into playlists (client_id, name, slides, settings, site_ids) values (c1, 'ma wide', '[]', '{}', array[sA, sB]);
    r := r || E'FAIL created a playlist for a site they don''t have\n';
  exception when others then r := r || format(E'PASS create for other site blocked (%s)\n', sqlerrm); end;
  begin
    update playlists set site_ids = null where id = pA;
    r := r || E'FAIL widened playlist to all sites\n';
  exception when others then r := r || format(E'PASS widen to all sites blocked (%s)\n', sqlerrm); end;
  begin
    update playlists set site_ids = array[sA, sC] where id = pA;
    r := r || E'FAIL widened playlist to site C\n';
  exception when others then r := r || format(E'PASS widen to site C blocked (%s)\n', sqlerrm); end;
  update playlists set name = 'A edited' where id = pA; get diagnostics n = row_count;
  r := r || format(E'%s can edit own-site playlist (%s row)\n', case when n = 1 then 'PASS' else 'FAIL' end, n);
  update playlists set name = 'x' where id = pS; get diagnostics n = row_count;
  r := r || format(E'%s shared playlist is read-only to them (%s rows)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);
  begin
    update playlists set site_ids = array[sA] where id = pS; get diagnostics n = row_count;
    r := r || format(E'%s can''t narrow/steal a shared playlist (%s rows)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);
  exception when others then r := r || format(E'PASS can''t narrow/steal a shared playlist (%s)\n', sqlerrm); end;
  update playlists set name = 'x' where id = pAB; get diagnostics n = row_count;
  r := r || format(E'%s A+B playlist is read-only to a site-A person (%s rows)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);
  delete from playlists where id in (pAB, pS, pB); get diagnostics n = row_count;
  r := r || format(E'%s can''t delete shared / other-site playlists (%s rows)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);
  update media set name = 'x' where id = mA; get diagnostics n = row_count;
  r := r || format(E'%s can edit own-site media (%s)\n', case when n = 1 then 'PASS' else 'FAIL' end, n);
  update media set name = 'x' where id in (mS, mB); get diagnostics n = row_count;
  r := r || format(E'%s can''t edit shared / other-site media (%s rows)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);
  update storage.objects set metadata = '{}' where bucket_id = 'media' and name in (c1 || '/t031-s.jpg', c1 || '/t031-b.jpg'); get diagnostics n = row_count;
  r := r || format(E'%s storage: can''t overwrite shared / other-site files (%s rows)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);
  update storage.objects set metadata = '{}' where bucket_id = 'media' and name = c1 || '/t031-a.jpg'; get diagnostics n = row_count;
  r := r || format(E'%s storage: can update own-site file (%s row)\n', case when n = 1 then 'PASS' else 'FAIL' end, n);
  select public.media_file_editable(c1 || '/t031-s.jpg') or public.media_file_editable(c1 || '/t031-b.jpg') into ok;
  r := r || format(E'%s storage delete check refuses shared / other-site files\n', case when not ok then 'PASS' else 'FAIL' end);
  insert into storage.objects (bucket_id, name, owner_id) values ('media', c1 || '/t031-up.jpg', ma::text);
  r := r || E'PASS storage: can upload a new file in own business folder\n';
  begin
    insert into schedule_items (screen_id, client_id, playlist_id, label) values (scrA, c1, pB, 'x');
    r := r || E'FAIL schedule rule used a playlist of another site\n';
  exception when others then r := r || format(E'PASS schedule rule with other-site playlist blocked (%s)\n', sqlerrm); end;
  insert into schedule_items (screen_id, client_id, playlist_id, label) values (scrA, c1, pS, 'x');
  r := r || E'PASS schedule rule with shared playlist on own TV allowed\n';
  begin
    update screens set default_playlist_id = pB where id = scrA;
    r := r || E'FAIL TV default set to other-site playlist\n';
  exception when others then r := r || format(E'PASS TV default to other-site playlist blocked (%s)\n', sqlerrm); end;
  update screens set default_playlist_id = pA where id = scrA; get diagnostics n = row_count;
  r := r || format(E'%s TV default to own-site playlist allowed (%s)\n', case when n = 1 then 'PASS' else 'FAIL' end, n);
  begin
    perform public.publish_playlist(pB);
    r := r || E'FAIL published another site''s playlist\n';
  exception when others then r := r || format(E'PASS publish other-site playlist blocked (%s)\n', sqlerrm); end;
  select count(*) into n from playlist_pauses where client_id = c1;
  r := r || format(E'%s pauses: sees shared playlist pause only (%s)\n', case when n = 1 then 'PASS' else 'FAIL' end, n);
  begin
    update client_members set features = '{"media":true,"billing":true}', site_ids = array[sA, sB] where user_id = ma and client_id = c1;
    r := r || E'FAIL changed own access\n';
  exception when others then r := r || format(E'PASS can''t edit own sites/features (%s)\n', sqlerrm); end;
  perform pg_temp.act(null);

  -- ---------------- staff limited to site B, playlists off
  perform pg_temp.act(sb);
  select count(*) into n from playlists where id = any(allp);
  r := r || format(E'%s site-B staff sees shared + B + AB (%s)\n', case when n = 3 then 'PASS' else 'FAIL' end, n);
  begin
    insert into playlists (client_id, name, slides, settings) values (c1, 'sb new', '[]', '{}');
    r := r || E'FAIL playlists feature off but insert worked\n';
  exception when others then r := r || format(E'PASS feature off -> write blocked (%s)\n', sqlerrm); end;
  update playlists set name = 'x' where id = pB; get diagnostics n = row_count;
  r := r || format(E'%s feature off -> edit own-site playlist blocked (%s rows)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);
  perform pg_temp.act(null);

  -- ---------------- other business
  perform pg_temp.act(o2);
  select count(*) into n from playlists where id = any(allp);
  r := r || format(E'%s other business owner sees only own playlist (%s)\n', case when n = 1 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from media where client_id = c1;
  r := r || format(E'%s other business sees 0 of our media (%s)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from storage.objects where bucket_id = 'media' and name like c1 || '/t031-%';
  r := r || format(E'%s other business sees 0 of our files (%s)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);
  update playlists set name = 'x' where id = pA; get diagnostics n = row_count;
  r := r || format(E'%s other business can''t edit our playlist (%s)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);
  perform pg_temp.act(null);

  -- ---------------- TV device (anonymous) in site B
  perform pg_temp.act(dev, true);
  select count(*) into n from storage.objects where bucket_id = 'media' and name like c1 || '/t031-%';
  r := r || format(E'%s TV device still reads every media file of its business (%s, media_device_read)\n', case when n >= 3 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from screens where id = scrB;
  r := r || format(E'%s TV device still reads its screen row (%s)\n', case when n = 1 then 'PASS' else 'FAIL' end, n);
  perform pg_temp.act(null);
  -- owner publishes TV A (site-A playlist + shared schedule rule): content carries both playlists
  perform pg_temp.act(o1);
  perform public.publish_screen(scrA);
  perform pg_temp.act(null);
  select (content -> 'playlists') ? pA::text and (content -> 'playlists') ? pS::text into ok from screens where id = scrA;
  r := r || format(E'%s published TV content includes site playlist + shared playlist\n', case when ok then 'PASS' else 'FAIL' end);

  raise exception E'TEST RESULTS (rolled back)\n%', r;
end $t$;
