-- 013: split-screen layouts. A playlist's settings.zones = [playlist for area 2, area 3, area 4].
--  TVs receive those playlists too, and publishing one of them updates TVs that show it in an area.

create or replace function public._build_screen_content(p_screen uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.screens;
  ids uuid[];
  also uuid[];
begin
  select * into s from public.screens where id = p_screen;
  -- keep only add-ons that still exist and belong to this client
  also := array(select x from unnest(coalesce(s.also_playlist_ids, '{}')) with ordinality u(x, n)
                 where exists (select 1 from public.playlists p where p.id = u.x and p.client_id = s.client_id)
                   and u.x is distinct from s.default_playlist_id
                 order by n);
  ids := array(
    select distinct x from (
      select s.default_playlist_id as x
      union all select unnest(also)
      union all select playlist_id from public.schedule_items where screen_id = p_screen and enabled
    ) q where x is not null);
  if s.default_playlist_id is null and coalesce(array_length(also, 1), 0) = 0 and not exists
     (select 1 from public.schedule_items where screen_id = p_screen and enabled) then
    return null;
  end if;
  -- playlists shown in the other areas of a split-screen layout (and the old side panel)
  ids := ids || array(
    select distinct z.v::uuid
      from public.playlists p
      cross join lateral (
        select p.settings ->> 'side_playlist_id' as v
        union all
        select jsonb_array_elements_text(case when jsonb_typeof(p.settings -> 'zones') = 'array' then p.settings -> 'zones' else '[]'::jsonb end)
      ) z
     where p.id = any(ids) and p.client_id = s.client_id
       and coalesce(z.v, '') ~ '^[0-9a-f-]{36}$');
  return jsonb_build_object(
    'version',  extract(epoch from clock_timestamp()),
    'default',  s.default_playlist_id,
    'also',     to_jsonb(also),
    'schedule', coalesce((
       select jsonb_agg(jsonb_build_object(
                'id', i.id, 'label', i.label, 'playlist_id', i.playlist_id,
                'days', i.days, 'start_time', to_char(i.start_time, 'HH24:MI'),
                'end_time', to_char(i.end_time, 'HH24:MI'),
                'start_date', i.start_date, 'end_date', i.end_date, 'priority', i.priority,
                'day_times', i.day_times)
              order by i.priority desc, i.created_at desc)
         from public.schedule_items i where i.screen_id = p_screen and i.enabled), '[]'::jsonb),
    'playlists', coalesce((
       select jsonb_object_agg(p.id, jsonb_build_object('name', p.name, 'slides', p.slides, 'settings', p.settings))
         from public.playlists p where p.id = any(ids) and p.client_id = s.client_id), '{}'::jsonb)
  );
end;
$$;
revoke all on function public._build_screen_content(uuid) from public, anon, authenticated;

create or replace function public._screens_using_playlist(p_client uuid, p_playlist uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from public.screens
   where client_id = p_client and public.license_ok(license_type, license_expires_at)
     and (default_playlist_id = p_playlist
          or p_playlist = any(also_playlist_ids)
          or id in (select screen_id from public.schedule_items where playlist_id = p_playlist)
          or default_playlist_id in (select id from public.playlists where client_id = p_client and (settings ->> 'side_playlist_id' = p_playlist::text or coalesce(settings -> 'zones', '[]'::jsonb) ? p_playlist::text))
          or id in (select si.screen_id from public.schedule_items si join public.playlists pp on pp.id = si.playlist_id
                     where pp.settings ->> 'side_playlist_id' = p_playlist::text or coalesce(pp.settings -> 'zones', '[]'::jsonb) ? p_playlist::text));
$$;

-- Emails: wordmark without the space, same weight for both words.
create or replace function public._email_html(p_title text, p_body text)
returns text language sql immutable as $$
  select '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;padding:24px">'
      || '<div style="font-weight:500;letter-spacing:.06em;margin-bottom:18px">PROVIEW<span style="color:#4a6cd0">SIGNAGE</span></div>'
      || '<h2 style="margin:0 0 10px;font-size:20px">' || public._esc(p_title) || '</h2>'
      || '<p style="color:#444;line-height:1.5;margin:0">' || public._esc(p_body) || '</p>'
      || '<p style="color:#999;font-size:12px;margin-top:28px">Automatic alert from PROVIEW SIGNAGE · www.proviewsignage.co.uk · 020 8935 5495</p></div>';
$$;

create or replace function public.send_invite_email(p_invite uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  i public.invites;
  cname text;
  inviter text := coalesce(auth.jwt() ->> 'email', 'PROVIEW SIGNAGE');
  link text;
  html text;
begin
  select * into i from public.invites where id = p_invite;
  if not found then raise exception 'Invite not found.'; end if;
  if not (public.is_admin() or public.is_member(i.client_id, array['manager'])) then raise exception 'Only managers can send invites.'; end if;
  if i.accepted_at is not null then raise exception 'This invite has already been accepted.'; end if;
  if public._secret('resend_api_key') is null then
    raise exception 'Email sending isn''t set up yet. An admin needs to add the Resend API key in Clients & TVs → Alerts & email. Meanwhile, copy the link and send it yourself.';
  end if;
  select coalesce(nullif(site_name, ''), name) into cname from public.clients where id = i.client_id;
  link := rtrim((select app_url from public.app_settings where id = 1), '/') || '/#/join/' || i.token;
  html := '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;padding:28px 24px;color:#17171c">'
    || '<div style="font-weight:500;letter-spacing:.06em;margin-bottom:22px">PROVIEW<span style="color:#4a6cd0">SIGNAGE</span></div>'
    || '<h2 style="margin:0 0 12px;font-size:22px">You''re invited to manage ' || public._esc(cname) || '’s screens</h2>'
    || '<p style="color:#444;line-height:1.55;margin:0 0 22px">' || public._esc(inviter) || ' has given you <b>'
    || case when i.role = 'manager' then 'manager' else 'editor' end
    || '</b> access to the digital signage for <b>' || public._esc(cname) || '</b>. '
    || 'Create your account with this email address (' || public._esc(i.email) || ') to get started.</p>'
    || '<a href="' || public._esc(link) || '" style="display:inline-block;background:#3d73d3;background-image:linear-gradient(135deg,#2f84d4,#5a5fbb);color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px">Accept invite</a>'
    || '<p style="color:#888;font-size:13px;line-height:1.5;margin:22px 0 0">Or open this link: <br><a href="' || public._esc(link) || '" style="color:#3d73d3;word-break:break-all">' || public._esc(link) || '</a></p>'
    || '<p style="color:#999;font-size:12px;margin-top:30px;border-top:1px solid #eee;padding-top:14px">PROVIEW SIGNAGE · www.proviewsignage.co.uk · Support 020 8935 5495</p></div>';
  if not public._send_email(array[i.email], 'You''re invited to ' || cname || ' on PROVIEW SIGNAGE', html) then
    raise exception 'The email could not be sent. Copy the link and send it yourself.';
  end if;
  update public.invites set emailed_at = now() where id = i.id;
  return true;
end;
$$;
revoke all on function public.send_invite_email(uuid) from public, anon;
grant execute on function public.send_invite_email(uuid) to authenticated;
