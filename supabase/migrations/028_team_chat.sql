-- =====================================================================
--  028: team chat
--  Messages between the people of one client (business). Everyone in the
--  client's team reads them; a message with to_user set is a direct
--  message, read only by its author and that person. Proview admins can
--  read the team channel (is_member covers admins). Messages are never
--  edited; the author can delete their own. Safe to re-run.
-- =====================================================================

create table if not exists public.team_messages (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  author      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_email text default (auth.jwt() ->> 'email'),
  to_user     uuid references auth.users(id) on delete cascade,
  body        text not null check (length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index if not exists team_messages_client_idx on public.team_messages(client_id, created_at desc);
alter table public.team_messages enable row level security;

drop policy if exists team_messages_read on public.team_messages;
create policy team_messages_read on public.team_messages for select to authenticated
  using (public.is_member(client_id)
         and (to_user is null or author = auth.uid() or to_user = auth.uid()));

drop policy if exists team_messages_send on public.team_messages;
create policy team_messages_send on public.team_messages for insert to authenticated
  with check (public.is_real_user() and author = auth.uid() and public.is_member(client_id)
              and (to_user is null or exists (select 1 from public.client_members m where m.client_id = team_messages.client_id and m.user_id = to_user)));

drop policy if exists team_messages_delete on public.team_messages;
create policy team_messages_delete on public.team_messages for delete to authenticated
  using (author = auth.uid());

grant select, insert, delete on public.team_messages to authenticated;

-- the people of a client, for the chat's member list (emails only, members only)
create or replace function public.team_people(p_client uuid)
returns table (user_id uuid, email text, role text)
language sql stable security definer set search_path = public as $$
  select m.user_id, coalesce(p.email, u.email)::text, m.role
    from public.client_members m
    left join public.profiles p on p.id = m.user_id
    left join auth.users u on u.id = m.user_id
   where m.client_id = p_client and public.is_member(p_client)
   order by 2;
$$;
revoke all on function public.team_people(uuid) from public, anon;
grant execute on function public.team_people(uuid) to authenticated;
