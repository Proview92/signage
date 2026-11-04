-- Publishing now also sets reload_at: keep it out of the activity log so publishes still read "published".
create or replace function public.log_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  act text := lower(tg_op) || 'd';
  ent text := tg_argv[0];
  cid uuid;
  nm text;
  det text := null;
  changed text[];
begin
  -- only log people, not TVs or background jobs
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return coalesce(new, old);
  end if;
  if act = 'insertd' then act := 'created'; elsif act = 'updated' then act := 'updated'; else act := 'deleted'; end if;

  cid := case when ent = 'client' then (r ->> 'id')::uuid else nullif(r ->> 'client_id', '')::uuid end;
  nm := coalesce(r ->> 'name', r ->> 'label', r ->> 'email', r ->> 'message');

  if tg_op = 'UPDATE' then
    select array_agg(k) into changed
      from jsonb_object_keys(r) k
     where r -> k is distinct from o -> k
       and k not in ('updated_at', 'last_seen', 'device_info', 'schedule_updated_at', 'hardware_id', 'pairing_code', 'created_at', 'reload_at', 'update_requested_at');
    if changed is null then return new; end if;
    if ent = 'screen' then
      if changed = array['content'] or changed <@ array['content', 'published_at'] then act := 'published'; det := null;
      elsif changed && array['license_type', 'license_expires_at'] then act := 'licence changed';
        det := coalesce(r ->> 'license_type', 'none') || coalesce(' until ' || to_char((r ->> 'license_expires_at')::timestamptz, 'DD Mon YYYY'), '');
      elsif changed <@ array['screenshot_requested_at', 'screenshot_at', 'screenshot_path', 'reload_at'] then return new;
      else det := array_to_string(changed, ', ');
      end if;
    elsif ent = 'playlist' then
      det := case when changed <@ array['slides'] then 'slides edited' else array_to_string(changed, ', ') end;
    else
      det := array_to_string(changed, ', ');
    end if;
    -- collapse rapid autosaves of the same thing by the same person
    if exists (select 1 from public.activity a where a.entity = ent and a.entity_id = r ->> 'id' and a.user_id = auth.uid()
                and a.action = act and a.at > now() - interval '10 minutes') then
      update public.activity set at = now(), details = det, entity_name = nm
       where id = (select id from public.activity a where a.entity = ent and a.entity_id = r ->> 'id' and a.user_id = auth.uid()
                    and a.action = act order by at desc limit 1);
      return new;
    end if;
  end if;

  insert into public.activity (client_id, user_id, email, action, entity, entity_id, entity_name, details)
  values (cid, auth.uid(), auth.jwt() ->> 'email', act, ent, r ->> 'id', nm, det);
  return coalesce(new, old);
exception when others then
  return coalesce(new, old);   -- never block the real change
end;
$$;
