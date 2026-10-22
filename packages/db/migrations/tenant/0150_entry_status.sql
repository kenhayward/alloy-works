-- Re-checks (the XR plan, XR-E to XR-G; docs/design/reference-sources.md). The citation index is the
-- reference index already: CIa writes a row per citation of an entry, `to_kind` 'bibliographyEntry',
-- with each component's latest version, so nothing is added for it here.

-- An entry's status (XR-F): the system's word about it from its last check, beside it and never a
-- version. `differs` names the CSL variables the source now holds otherwise; `notice` the retraction
-- or correction decided on; `notified` who has been told of this outcome, emptied when it changes, so
-- an entry that turns current and is then retracted again is told of again.
create table bibliography_entry_status (
  entry_id uuid primary key,
  entry_kind text not null default 'bibliographyEntry' check (entry_kind = 'bibliographyEntry'),
  source text not null constraint bibliography_entry_status_source check (source in ('crossref', 'pubmed')),
  checked_at timestamptz not null default now(),
  outcome text not null
    check (outcome in ('current', 'changed', 'gone', 'retracted', 'corrected')),
  differs text[] not null default '{}',
  notice jsonb check (notice is null or jsonb_typeof(notice) = 'object'),
  notified uuid[] not null default '{}',
  foreign key (entry_id, entry_kind) references artifact (id, kind) on delete cascade
);
create index bibliography_entry_status_checked on bibliography_entry_status (checked_at);

do $$
begin
  execute format('revoke insert, update, delete, truncate on bibliography_entry_status from %I', current_schema());
  -- Inserted or updated, never deleted but with its entry; `for update` needs the update grant.
  execute format(
    'grant select, insert (entry_id, source, checked_at, outcome, differs, notice, notified), update (source, checked_at, outcome, differs, notice, notified) on bibliography_entry_status to %I',
    current_schema()
  );
end
$$;

-- A cited entry retracted or corrected (XR-G): its document's owner told, from nobody, on the document;
-- its counts name the entry and the outcome, never the entry's content.
alter table notification
  drop constraint notification_kind,
  drop constraint notification_digest;
alter table notification
  add constraint notification_kind
    check (kind in ('mention', 'reply', 'resolution', 'round', 'digest', 'budget', 'webhook', 'reference')),
  add constraint notification_digest check (
    (kind in ('digest', 'budget', 'webhook', 'reference')) = (counts is not null)
    and (
      (kind = 'digest' and round_id is null and thread_id is null)
      or (kind in ('budget', 'webhook') and actor is null and round_id is null and thread_id is null
          and artifact_id is null)
      or (kind = 'reference' and actor is null and round_id is null and thread_id is null
          and artifact_id is not null)
      or (kind = 'round' and actor is not null and round_id is not null and thread_id is null
          and artifact_id is not null)
      or (kind not in ('round', 'digest', 'budget', 'webhook', 'reference') and actor is not null
          and thread_id is not null and round_id is null and artifact_id is not null)
    )
  );
