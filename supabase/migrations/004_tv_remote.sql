-- =====================================================================
--  PROVIEW SIGNAGE — TV remote menu settings (PIN + auto-return)
--  Run after 003_trial_devices.sql. Safe to re-run.
--
--  One set of settings for all TVs, managed by the admin:
--    remote_pin_hash  sha256('proview-pin:' || pin), hex. Default PIN 1234.
--    return_minutes   reopen the player this many minutes after someone
--                     leaves it (Home button / Exit). 0 = never.
--  Only TVs (anonymous sessions) and admins can read the PIN hash.
-- =====================================================================

create table if not exists public.app_settings (
  id               int primary key default 1 check (id = 1),
  remote_pin_hash  text,
  pin_is_default   boolean not null default true,
  return_minutes   int not null default 5 check (return_minutes between 0 and 240),
  updated_at       timestamptz not null default now()
);
insert into public.app_settings (id, remote_pin_hash, pin_is_default)
values (1, encode(sha256(convert_to('proview-pin:1234', 'UTF8')), 'hex'), true)
on conflict (id) do nothing;

alter table public.app_settings enable row level security;
drop policy if exists app_settings_admin on public.app_settings;
create policy app_settings_admin on public.app_settings for select to authenticated
  using (public.is_admin());

-- TV: fetch remote settings (anonymous TV sessions only).
create or replace function public.get_tv_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is not null and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    then (select jsonb_build_object('pin_hash', remote_pin_hash, 'return_minutes', return_minutes)
            from public.app_settings where id = 1)
    else null end;
$$;

-- Admin: change PIN (4–8 digits; null keeps it) and/or return minutes.
create or replace function public.set_tv_settings(p_pin text default null, p_return_minutes int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the administrator can change TV settings.'; end if;
  if p_pin is not null and p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'The PIN must be 4 to 8 digits.';
  end if;
  update public.app_settings
     set remote_pin_hash = case when p_pin is not null
                                then encode(sha256(convert_to('proview-pin:' || p_pin, 'UTF8')), 'hex')
                                else remote_pin_hash end,
         pin_is_default  = case when p_pin is not null then p_pin = '1234' else pin_is_default end,
         return_minutes  = coalesce(p_return_minutes, return_minutes),
         updated_at      = now()
   where id = 1;
  return (select jsonb_build_object('pin_is_default', pin_is_default, 'return_minutes', return_minutes, 'updated_at', updated_at)
            from public.app_settings where id = 1);
end;
$$;

revoke all on function public.get_tv_settings() from public, anon;
grant execute on function public.get_tv_settings() to authenticated;
revoke all on function public.set_tv_settings(text, int) from public, anon;
grant execute on function public.set_tv_settings(text, int) to authenticated;
