-- =====================================================================
--  028: Play / Pause / Stop for individual playlists
--  playlist_pauses: one row per paused or stopped playlist
--    until = a time  → paused, plays again by itself after that
--    until = infinity → stopped, until someone presses Play
--  The pause is also copied onto every TV of the account (screens.paused_playlists),
--  so TVs react straight away without republishing (unpublished edits stay unpublished).
--  While a playlist is off, TVs skip it and play whatever else is scheduled. Safe to re-run.
-- =====================================================================

create table if not exists public.playlist_pauses (
  playlist_id uuid primary key references public.playlists(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  until       timestamptz not null,
  set_by      uuid default auth.uid(),
  set_at      timestamptz not null default now()
);
alter table public.playlist_pauses enable row level security;
drop policy if exists playlist_pauses_read on public.playlist_pauses;
create policy playlist_pauses_read on public.playlist_pauses for select using (public.is_member(client_id));

alter table public.screens add column if not exists paused_playlists jsonb not null default '{}'::jsonb;
comment on column public.screens.paused_playlists is 'Playlists switched off: {playlist_id: "stop" | ISO time it plays again}';

-- p_until: null = Play; 'infinity' = Stop; a time = Pause until then
create or replace function public.set_playlist_pause(p_playlist uuid, p_until timestamptz)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  c uuid;
  playing boolean := p_until is null or p_until <= now();
begin
  select client_id into c from public.playlists where id = p_playlist;
  if c is null or not public.is_member(c) then raise exception 'playlist not found'; end if;
  if playing then
    delete from public.playlist_pauses where playlist_id = p_playlist;
    update public.screens set paused_playlists = coalesce(paused_playlists, '{}'::jsonb) - p_playlist::text
     where client_id = c and paused_playlists ? p_playlist::text;
    return null;
  end if;
  insert into public.playlist_pauses (playlist_id, client_id, until) values (p_playlist, c, p_until)
  on conflict (playlist_id) do update set until = excluded.until, set_by = auth.uid(), set_at = now();
  update public.screens
     set paused_playlists = coalesce(paused_playlists, '{}'::jsonb)
         || jsonb_build_object(p_playlist::text, case when p_until = 'infinity' then to_jsonb('stop'::text) else to_jsonb(p_until) end)
   where client_id = c;
  return p_until;
end $$;

revoke all on function public.set_playlist_pause(uuid, timestamptz) from public, anon;
grant execute on function public.set_playlist_pause(uuid, timestamptz) to authenticated;

notify pgrst, 'reload schema';
