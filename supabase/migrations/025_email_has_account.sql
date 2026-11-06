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
