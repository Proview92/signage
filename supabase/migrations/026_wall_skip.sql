-- =====================================================================
--  026: "Skip to next content" on a video wall
--  The TVs in a wall play from a shared clock. Skipping moves that clock
--  forward for every TV in the wall, so they all jump to the next slide together.
--  Safe to re-run.
-- =====================================================================

alter table public.screens add column if not exists wall_shift bigint not null default 0;
comment on column public.screens.wall_shift is 'Video wall: ms added to the shared clock by "Skip to next content" (same on every TV in the wall)';

-- Called by a TV in a wall (or a manager of its account). p_ms = how far to move the clock on.
create or replace function public.wall_skip(p_ms bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  me public.screens;
  shift bigint;
begin
  if p_ms is null or p_ms <= 0 or p_ms > 6 * 3600000 then raise exception 'bad skip'; end if;
  select * into me from public.screens where device_user_id = auth.uid() limit 1;
  if me.id is null or me.wall is null or me.wall->>'id' is null then raise exception 'this screen is not in a video wall'; end if;
  shift := coalesce(me.wall_shift, 0) + p_ms;
  update public.screens set wall_shift = shift
   where client_id = me.client_id and wall->>'id' = me.wall->>'id';
  return shift;
end $$;

revoke all on function public.wall_skip(bigint) from public, anon;
grant execute on function public.wall_skip(bigint) to authenticated;

notify pgrst, 'reload schema';
