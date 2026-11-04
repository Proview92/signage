-- Per-TV screen rotation (degrees clockwise) for TVs mounted on their side.
alter table public.screens add column if not exists rotation smallint not null default 0;
do $$ begin
  alter table public.screens add constraint screens_rotation_chk check (rotation in (0, 90, 180, 270));
exception when duplicate_object then null; end $$;
