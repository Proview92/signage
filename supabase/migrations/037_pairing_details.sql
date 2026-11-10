-- 037: remember how each TV was paired (when, with which code, by whom),
-- so a TV can be identified later. The pairing code itself is cleared on
-- claim (so it can't be reused); we keep a copy in paired_code.

alter table public.screens
  add column if not exists paired_at   timestamptz,
  add column if not exists paired_code text,
  add column if not exists paired_by   text;

create or replace function public.screens_paired_stamp()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.claimed and not coalesce(old.claimed, false) then
    -- just paired: stamp it, whichever way it happened
    new.paired_at   := now();
    new.paired_code := coalesce(old.pairing_code, new.paired_code);
    new.paired_by   := coalesce(nullif(auth.jwt() ->> 'email', ''), new.paired_by);
  elsif current_user not in ('postgres', 'supabase_admin', 'service_role') then
    -- nobody edits the record by hand
    new.paired_at   := old.paired_at;
    new.paired_code := old.paired_code;
    new.paired_by   := old.paired_by;
  end if;
  return new;
end;
$$;

drop trigger if exists screens_paired_stamp on public.screens;
create trigger screens_paired_stamp
  before update on public.screens
  for each row execute function public.screens_paired_stamp();

-- Backfill TVs paired before today: the pairing time and person from the
-- activity log when we have it, otherwise when the TV first showed its code.
update public.screens s
   set paired_at = coalesce(a.at, s.created_at),
       paired_by = a.email
  from (select s2.id,
               (select a.at    from public.activity a where a.entity = 'screen' and a.entity_id = s2.id::text and a.details ilike '%claimed%' order by a.at limit 1) at,
               (select a.email from public.activity a where a.entity = 'screen' and a.entity_id = s2.id::text and a.details ilike '%claimed%' order by a.at limit 1) email
          from public.screens s2 where s2.claimed and s2.paired_at is null) a
 where s.id = a.id;
