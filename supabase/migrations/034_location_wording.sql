-- =====================================================================
--  034: error messages say "location" and "business", never "site" or "client"
--  Rewrites the messages inside the live functions in place (it reads each function's current definition,
--  swaps the text and re-creates it), so nothing else in them changes. Safe to re-run.
-- =====================================================================

do $m$
declare
  pairs text[][] := array[
    ['That site belongs to a different business.',            'That location belongs to a different business.'],
    ['That site belongs to a different client.',              'That location belongs to a different business.'],
    ['Only an owner or admin can share this with every site.', 'Only an owner or admin can share this with every location.'],
    ['You can only choose your own sites.',                   'You can only choose your own locations.'],
    ['That playlist isn''''t available for your sites.',        'That playlist isn''''t available at your locations.'],
    ['Pausing a playlist changes every site. Ask your owner or admin.', 'Pausing this playlist changes every location. Ask your owner or admin.'],
    ['The Proview master account can''''t start a trial. Add clients from All sites.', 'The Proview master account can''''t start a trial. Add businesses from the Locations page.'],
    ['choose a client',                                       'Choose a business for this TV.'],
    ['screen, playlist and schedule must belong to the same client', 'The TV, playlist and schedule must belong to the same business.'],
    ['playlist belongs to a different client',                'That playlist belongs to a different business.'],
    ['An admin needs to add the Resend API key in Clients & TVs → Alerts & email.', 'Proview needs to add the Resend API key under Locations → Platform settings → Alerts & email.']
  ];
  f record; d text; d2 text; i int; n int := 0;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prokind = 'f'
       and p.prosrc ~ '(site belongs|every site|your own sites|for your sites|changes every site|from All sites|choose a client|same client|different client|Clients & TVs)'
  loop
    d := pg_get_functiondef(f.oid); d2 := d;
    for i in 1 .. array_length(pairs, 1) loop
      d2 := replace(d2, pairs[i][1], pairs[i][2]);
    end loop;
    if d2 <> d then execute d2; n := n + 1; end if;
  end loop;
  raise notice '034: reworded messages in % function(s)', n;
end $m$;

notify pgrst, 'reload schema';
