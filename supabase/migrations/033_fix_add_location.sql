-- =====================================================================
--  033: fix "new row violates row-level security policy for table sites"
--  when adding a location.
--  Adding a location reads the new row straight back (insert … returning). The
--  read rule called can_site(), which first looks the location up in the table,
--  and inside that same statement the brand-new row isn't visible yet, so the
--  read was refused for everyone, master included.
--  Now: people who see all locations (master, Owner/Admin, members with no
--  location list) see every location of the business; location-limited people
--  see the ones in their list. No look-up of the row itself. Safe to re-run.
-- =====================================================================

alter policy sites_select on public.sites
  using (
    public.is_member(client_id)
    and (public.all_sites(client_id)
         or id = any(coalesce((public.my_membership(client_id)).site_ids, '{}'::uuid[])))
  );

-- Same idea in can_site(): answer from the person's access before looking the location up.
create or replace function public.can_site(p_client uuid, p_site uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare m public.client_members;
begin
  if p_client is null then return public.is_admin(); end if;
  if p_site is null then return public.all_sites(p_client); end if;
  if public.is_admin() then
    return exists (select 1 from public.sites s where s.id = p_site and s.client_id = p_client);
  end if;
  m := public.my_membership(p_client);
  if m.user_id is null then return false; end if;
  if not exists (select 1 from public.sites s where s.id = p_site and s.client_id = p_client) then return false; end if;
  return m.role = 'manager' or m.site_ids is null or p_site = any(m.site_ids);
end $$;

notify pgrst, 'reload schema';
