-- 011: send invites by email straight from PROVIEW SIGNAGE (via Resend)

alter table public.app_settings add column if not exists app_url text not null default 'https://app.proviewsignage.co.uk/';
alter table public.invites add column if not exists emailed_at timestamptz;

-- Emails now come from the verified proviewsignage.co.uk domain.
update public.app_settings set email_from = 'PROVIEW SIGNAGE <noreply@proviewsignage.co.uk>'
 where id = 1 and email_from ilike '%onboarding@resend.dev%';

create or replace function public._esc(t text) returns text language sql immutable as $$
  select replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');
$$;

-- Alert emails: blue brand colour.
create or replace function public._email_html(p_title text, p_body text)
returns text language sql immutable as $$
  select '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;padding:24px">'
      || '<div style="font-weight:800;letter-spacing:.06em;margin-bottom:18px">PROVIEW <span style="color:#4a6cd0;font-weight:500">SIGNAGE</span></div>'
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
    || '<div style="font-weight:800;letter-spacing:.06em;margin-bottom:22px">PROVIEW <span style="color:#4a6cd0;font-weight:500">SIGNAGE</span></div>'
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
