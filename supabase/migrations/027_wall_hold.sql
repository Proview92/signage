-- =====================================================================
--  027: "Skip to next content" holds the content on screen; "Reactivate schedule" lets go
--  For a video wall the hold is shared: every TV in the wall stays on the same slide.
--  screens.wall_hold = the wall-clock moment (ms) whose slide is held; null = follow the schedule.
--  Safe to re-run.
-- =====================================================================

alter table public.screens add column if not exists wall_hold bigint;
comment on column public.screens.wall_hold is 'Video wall held from the TV menu: wall-clock ms of the slide on screen; null = normal';

create or replace function public.wall_hold(p_at bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare me public.screens;
begin
  select * into me from public.screens where device_user_id = auth.uid() limit 1;
  if me.id is null or me.wall is null or me.wall->>'id' is null then raise exception 'this screen is not in a video wall'; end if;
  update public.screens set wall_hold = p_at
   where client_id = me.client_id and wall->>'id' = me.wall->>'id';
  return p_at;
end $$;

revoke all on function public.wall_hold(bigint) from public, anon;
grant execute on function public.wall_hold(bigint) to authenticated;

notify pgrst, 'reload schema';
