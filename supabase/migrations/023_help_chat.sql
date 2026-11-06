-- =====================================================================
--  023: AI help chat — daily question limit per person
--  The help-chat Edge Function calls help_chat_tick() before each answer.
--  Only signed-in people (not TVs) can use it; 40 questions per person per day.
--  Safe to re-run.
-- =====================================================================

create table if not exists public.help_chat_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null default (now() at time zone 'Europe/London')::date,
  n       int  not null default 0,
  primary key (user_id, day)
);
alter table public.help_chat_usage enable row level security;
-- No policies: only the function below touches this table.

create or replace function public.help_chat_tick(p_limit int default 40)
returns int language plpgsql security definer set search_path = public as $$
declare
  used int;
  today date := (now() at time zone 'Europe/London')::date;
begin
  if not public.is_real_user() then raise exception 'sign in to use the help chat'; end if;
  insert into public.help_chat_usage (user_id, day, n) values (auth.uid(), today, 1)
  on conflict (user_id, day) do update set n = help_chat_usage.n + 1
  returning n into used;
  if used > p_limit then
    raise exception 'You have reached today''s limit of % questions. It resets at midnight, or call us on 020 8935 5495.', p_limit;
  end if;
  -- tidy up old rows now and then
  if random() < 0.02 then delete from public.help_chat_usage where day < today - 30; end if;
  return p_limit - used;
end $$;

revoke all on function public.help_chat_tick(int) from public, anon;
grant execute on function public.help_chat_tick(int) to authenticated;
