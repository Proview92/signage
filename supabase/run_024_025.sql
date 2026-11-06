-- PROVIEW SIGNAGE: run once — 024 sleep hours + 025 sign-in check. Safe to re-run.
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

-- =====================================================================
--  025: sign-in page — tell "no account with this email" apart from "wrong password"
--  Used only after a sign-in fails, so the page can offer to create an account.
--  Safe to re-run.
-- =====================================================================

create or replace function public.email_has_account(p_email text)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from auth.users
    where lower(email) = lower(trim(p_email)) and not coalesce(is_anonymous, false)
  );
$$;

revoke all on function public.email_has_account(text) from public;
grant execute on function public.email_has_account(text) to anon, authenticated;

-- make the new columns visible to the dashboard straight away
notify pgrst, 'reload schema';
