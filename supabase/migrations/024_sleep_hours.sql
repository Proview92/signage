-- =====================================================================
--  024: sleep hours — TVs switch off out of hours and wake up again
--  screens.sleep          { on, days[0-6], from 'HH:MM', to 'HH:MM', off }
--  screens.sleep_override { state: 'sleep' | 'wake', until }  ("Sleep now" / "Wake now")
--  Both are read by the TV with the rest of its row. Safe to re-run.
-- =====================================================================

alter table public.screens add column if not exists sleep jsonb;
alter table public.screens add column if not exists sleep_override jsonb;

comment on column public.screens.sleep is 'Sleep hours: {on, days (0=Sun), from, to, off (switch TV off vs black screen)}';
comment on column public.screens.sleep_override is 'Manual Sleep now / Wake now from the dashboard: {state, until}';
