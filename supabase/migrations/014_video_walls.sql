-- Video walls: several TVs showing one picture together.
-- screens.wall = { id, name, cols, rows, x, y, bezel } — this TV's place in the wall (x/y 0-based).
alter table public.screens add column if not exists wall jsonb;

-- Server time in milliseconds, so the TVs in a wall can agree on "now".
create or replace function public.server_now()
returns double precision language sql volatile as $$
  select floor(extract(epoch from clock_timestamp()) * 1000)::double precision
$$;
grant execute on function public.server_now() to anon, authenticated;
