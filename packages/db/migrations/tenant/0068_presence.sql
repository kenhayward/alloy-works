-- Who is in a document, where and doing what (realtime.md; the PL plan, PL-C and PL-D): a row per window,
-- written by the window's own beat every 20 seconds and on each change. Unlogged - fast to write, gone
-- after a crash, which is what presence should do anyway, and never on a standby. No foreign keys: a row
-- outlives nothing, and the worker tidies any past a minute old. Each write and each removal says so on
-- the tenant's channel, by the window's id alone; the stream reads the row and decides what its viewer
-- may hear of it.
create unlogged table presence (
  viewer uuid primary key,
  principal_id uuid not null,
  document_id uuid not null,
  component_id uuid,
  mode text not null check (mode in ('read', 'review', 'author')),
  beat_at timestamptz not null default now()
);
create index presence_document on presence (document_id, beat_at);

create function presence_changed() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform pg_notify('aw_t_' || substring(tg_table_schema from 3),
      jsonb_build_object('kind', 'presence_left', 'viewer', old.viewer, 'document', old.document_id)::text);
  else
    perform pg_notify('aw_t_' || substring(tg_table_schema from 3),
      jsonb_build_object('kind', 'presence', 'viewer', new.viewer, 'document', new.document_id)::text);
  end if;
  return null;
end
$$;

create trigger presence_live after insert or update or delete on presence
  for each row execute function presence_changed();
