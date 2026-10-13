-- Threads searchable (SCH-071; the SV plan, SV-K, SV-L): one `search_entry` per thread, on the artifact
-- it is anchored to, so the one predicate filters it and that artifact's acts hide it. Each message is a
-- `search_text` place, `message:<comment id>`, appended as it is written, never by re-reading the thread.
-- Derived, as 0031's rows are: the run that applies this file writes every thread's (`reindexSearch`,
-- 'threads').

alter table search_entry drop constraint search_entry_kind_check;
alter table search_entry add constraint search_entry_kind_check check (kind in
  ('component', 'document', 'section', 'publication', 'template', 'asset',
   'field', 'metadataSchema', 'componentType', 'queryDefinition', 'thread'));

-- The thread, and nothing else's.
alter table search_entry add column thread_id uuid references thread on delete cascade;
alter table search_entry add constraint search_entry_thread
  check ((thread_id is not null) = (kind = 'thread'));

-- A section's node, or the node a thread on a document stands at; nothing else has one.
alter table search_entry drop constraint search_entry_check;
alter table search_entry add constraint search_entry_node check (
  case kind when 'section' then node is not null when 'thread' then true else node is null end);

-- Each thread its own row beside its artifact's and its sections'.
alter table search_entry drop constraint search_entry_once;
alter table search_entry add constraint search_entry_once
  unique nulls not distinct (artifact_id, node, thread_id);

-- A plain column, so a message's words are appended to it (`vector || to_tsvector(...)`) rather than
-- the whole made again; every writer sets it.
alter table search_entry alter column vector drop expression;
alter table search_entry alter column vector set not null;

-- A message finds its thread's row by the thread alone.
create index search_entry_thread on search_entry (thread_id) where thread_id is not null;
