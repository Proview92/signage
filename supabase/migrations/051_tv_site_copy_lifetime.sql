-- 051: per-TV licences only (050). A TV's copy of its location's licence always reads lifetime, so a TV player still
-- running code from before 050 (which also checked the location) keeps playing.
create or replace function public.screens_site_licence()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.site_license_type := 'lifetime';
  new.site_license_expires_at := null;
  return new;
end $$;
update public.screens set site_license_type = 'lifetime', site_license_expires_at = null;
