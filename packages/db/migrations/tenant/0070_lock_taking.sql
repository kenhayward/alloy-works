-- Taking a lock from an idle holder (collaboration.md, Taking; the PL plan, PL-G and PL-H): who has asked
-- for it and from which session, and when the holder's grace to keep it ends; and, once taken, the
-- session it was taken from, so that session's next save is told who has it (`lock_taken`) rather than
-- that nobody does. Each is cleared by the holder's next activity, and the stream hears an ask made or
-- ended as it hears a lock moved.
alter table component_lock
  add column taking_by uuid,
  add column taking_session uuid,
  add column taking_until timestamptz,
  add column taken_from uuid,
  add constraint component_lock_taking_whole check (
    (taking_by is null) = (taking_session is null) and (taking_by is null) = (taking_until is null)
  );

-- 0067's trigger, an ask made or ended said too.
create or replace function lock_changed() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform pg_notify('aw_t_' || substring(tg_table_schema from 3),
      jsonb_build_object('kind', 'lock', 'component', old.artifact_id)::text);
  elsif tg_op = 'INSERT'
    or new.principal_id is distinct from old.principal_id
    or new.session_id is distinct from old.session_id
    or new.taking_by is distinct from old.taking_by
    or new.taking_until is distinct from old.taking_until
    or date_trunc('minute', new.expires_at) is distinct from date_trunc('minute', old.expires_at) then
    perform pg_notify('aw_t_' || substring(tg_table_schema from 3),
      jsonb_build_object('kind', 'lock', 'component', new.artifact_id)::text);
  end if;
  return null;
end
$$;
