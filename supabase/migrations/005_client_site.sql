-- =====================================================================
--  PROVIEW SIGNAGE — site name & contact email for clients
--  Run after 004_tv_remote.sql. Safe to re-run.
-- =====================================================================

alter table public.clients add column if not exists site_name     text;
alter table public.clients add column if not exists contact_email text;

-- Clients created with an email as their name: keep it as the contact email.
update public.clients
   set contact_email = lower(trim(name))
 where contact_email is null and name ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';

-- whoami: include site name + contact email for the client picker.
create or replace function public.whoami()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id',  auth.uid(),
    'email',    auth.jwt() ->> 'email',
    'is_admin', public.is_admin(),
    'clients',  coalesce((
       select jsonb_agg(jsonb_build_object(
                'id', c.id, 'name', c.name, 'site_name', c.site_name, 'contact_email', c.contact_email,
                'role', case when public.is_admin() then coalesce(m.role, 'admin') else m.role end)
              order by lower(coalesce(nullif(c.site_name, ''), c.name)))
         from public.clients c
         left join public.client_members m on m.client_id = c.id and m.user_id = auth.uid()
        where public.is_admin() or m.user_id is not null), '[]'::jsonb)
  );
$$;

-- Invite page: show the site name if there is one.
create or replace function public.invite_info(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('client', coalesce(nullif(c.site_name, ''), c.name), 'email', i.email, 'role', i.role,
                            'used', i.accepted_at is not null)
    from public.invites i join public.clients c on c.id = i.client_id
   where i.token = p_token;
$$;
