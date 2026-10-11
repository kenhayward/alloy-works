-- What a document's stream hears (realtime.md; the PL plan, PL-B, PL-I and PL-J), said by the database
-- in the transaction that changed it, so no write path can forget to: a lock claimed, moved or released,
-- or its expected release moving on to another minute; a document's new version; and any change to
-- access, which ends every stream of the tenant so each reconnects authorised afresh. Ids only, on the
-- tenant's channel, named after the trigger's own schema as `notifyTenant` names it after the role, so a
-- write by any role, whatever its search path, says it.

create function lock_changed() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform pg_notify('aw_t_' || substring(tg_table_schema from 3),
      jsonb_build_object('kind', 'lock', 'component', old.artifact_id)::text);
  elsif tg_op = 'INSERT'
    or new.principal_id is distinct from old.principal_id
    or new.session_id is distinct from old.session_id
    or date_trunc('minute', new.expires_at) is distinct from date_trunc('minute', old.expires_at) then
    perform pg_notify('aw_t_' || substring(tg_table_schema from 3),
      jsonb_build_object('kind', 'lock', 'component', new.artifact_id)::text);
  end if;
  return null;
end
$$;

create trigger component_lock_live after insert or update or delete on component_lock
  for each row execute function lock_changed();

create function outline_changed() returns trigger
language plpgsql as $$
begin
  perform pg_notify('aw_t_' || substring(tg_table_schema from 3),
    jsonb_build_object('kind', 'outline', 'document', new.artifact_id)::text);
  return null;
end
$$;

create trigger artifact_version_live after insert on artifact_version
  for each row when (new.kind = 'document') execute function outline_changed();

-- 0013's function, with the stream told: every fact's trigger runs it, so every change to access does.
create or replace function access_changed() returns trigger
language plpgsql as $$
begin
  if current_setting('alloy.deciding_only', true) = 'on' then
    raise exception 'access changed in a transaction that declared that it only decides'
      using hint = 'A route that changes access declares changesAccess, so it takes the epoch FOR UPDATE before it decides';
  end if;
  execute format('update %I.access_epoch set changed_at = now()', tg_table_schema);
  perform pg_notify('aw_t_' || substring(tg_table_schema from 3), '{"kind":"permissions"}');
  return null;
end
$$;
