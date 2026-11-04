-- Every publish also tells the TV to reload, so it always picks up the new content
-- (covers the Publish button, Re-send to TV, quick playlist switch and approvals).
create or replace function public.screens_reload_on_publish()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.published_at is distinct from old.published_at and new.content is not null then
    new.reload_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists screens_reload_on_publish on public.screens;
create trigger screens_reload_on_publish before update on public.screens
  for each row execute function public.screens_reload_on_publish();
