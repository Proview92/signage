-- Admin can reset a user's password to the temporary password 123456.
-- The user must choose a new password when they next sign in; the temporary one stops working after 24 hours.
-- Flags live in auth.users.raw_app_meta_data (part of the user's login token; users cannot change it themselves):
--   must_change_password: true, temp_password_until: <timestamp>

create or replace function public.admin_reset_password(p_user uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare em text;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  perform set_config('signage.admin_reset', '1', true);   -- tells the trigger below not to clear the flag
  update auth.users
     set encrypted_password = extensions.crypt('123456', extensions.gen_salt('bf')),
         raw_app_meta_data = (coalesce(raw_app_meta_data, '{}'::jsonb) - 'temp_password_expired')
           || jsonb_build_object('must_change_password', true, 'temp_password_until', now() + interval '24 hours'),
         updated_at = now()
   where id = p_user and coalesce(is_anonymous, false) = false
  returning email into em;
  if em is null then raise exception 'user not found'; end if;
  delete from auth.sessions where user_id = p_user;          -- signs them out everywhere
  return em;
end;
$$;
revoke all on function public.admin_reset_password(uuid) from public, anon;
grant execute on function public.admin_reset_password(uuid) to authenticated;

-- When the user sets their own new password, clear the flags.
create or replace function public.auth_clear_temp_password()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('signage.admin_reset', true), '') = '1' then return new; end if;
  if new.encrypted_password is distinct from old.encrypted_password
     and coalesce(old.raw_app_meta_data ->> 'must_change_password', '') = 'true' then
    new.raw_app_meta_data := new.raw_app_meta_data - 'must_change_password' - 'temp_password_until' - 'temp_password_expired';
  end if;
  return new;
end;
$$;
drop trigger if exists auth_clear_temp_password on auth.users;
create trigger auth_clear_temp_password before update on auth.users
  for each row execute function public.auth_clear_temp_password();

-- Temporary passwords not used within 24 hours stop working (replaced by a random one).
create or replace function public.expire_temp_passwords()
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform set_config('signage.admin_reset', '1', true);
  update auth.users
     set encrypted_password = extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
         raw_app_meta_data = (raw_app_meta_data - 'temp_password_until') || jsonb_build_object('temp_password_expired', true)
   where raw_app_meta_data ->> 'must_change_password' = 'true'
     and (raw_app_meta_data ->> 'temp_password_until')::timestamptz < now();
end;
$$;
revoke all on function public.expire_temp_passwords() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('signage-expire-temp-passwords') where exists (select 1 from cron.job where jobname = 'signage-expire-temp-passwords');
  perform cron.schedule('signage-expire-temp-passwords', '7 * * * *', 'select public.expire_temp_passwords()');
exception when others then
  raise notice 'Could not schedule job: %', sqlerrm;
end $$;
