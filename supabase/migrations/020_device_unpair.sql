-- "Unlink this TV" from the TV app's own menu (protected by the menu PIN on the TV).
-- A TV can only unlink itself: the row is found by the TV's own sign-in (device_user_id).
-- Clears the same things as "Remove TV" on the dashboard, plus any video-wall position,
-- and gives the TV a fresh pairing code so it shows the pairing screen again.
create or replace function public.device_unpair()
returns public.screens language plpgsql security definer set search_path = public as $$
declare
  s public.screens;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into s from public.screens where device_user_id = auth.uid();
  if not found then raise exception 'screen not found'; end if;
  delete from public.schedule_items where screen_id = s.id;
  update public.screens
     set claimed = false, client_id = null, default_playlist_id = null, also_playlist_ids = '{}', content = null,
         published_at = null, schedule_updated_at = null, name = 'New screen', location = null, wall = null,
         pairing_code = public.gen_pairing_code(), created_at = now()
   where id = s.id
   returning * into s;
  return s;
end;
$$;

revoke all on function public.device_unpair() from public, anon;
grant execute on function public.device_unpair() to authenticated;
