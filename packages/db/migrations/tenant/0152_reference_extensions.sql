-- Extensions of kind `reference` (the XR plan, XR-J; LIB-032; docs/design/reference-sources.md): one
-- joins the tenant's sources as `ext:` and its id, so the switch and an entry's status take that key.
alter table reference_source_policy drop constraint reference_source_policy_source;
alter table reference_source_policy add constraint reference_source_policy_source check (
  source in ('crossref', 'pubmed')
  or source ~ '^ext:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
);
alter table bibliography_entry_status drop constraint bibliography_entry_status_source;
alter table bibliography_entry_status add constraint bibliography_entry_status_source check (
  source in ('crossref', 'pubmed')
  or source ~ '^ext:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
);

-- A reference extension's secret, set by an administrator of the environment: sealed by the connector
-- for the extension and its endpoint's origin, so a changed endpoint needs it again: `endpoint` is the
-- one it was set for, and a secret set for another is no secret. The latest is its own; none is ever
-- changed.
create table extension_credential (
  id uuid primary key default gen_random_uuid(),
  extension_id uuid not null references extension on delete restrict,
  sealed text not null,
  endpoint text not null,
  set_by uuid references principal on delete set null,
  set_at timestamptz not null default now()
);
create index extension_credential_latest on extension_credential (extension_id, set_at desc, id desc);

do $$
begin
  execute format('revoke update, delete, truncate on extension_credential from %I', current_schema());
end
$$;

-- Each attempt to check an entry, answered or not (the XR plan, XR-E): the sweep takes the entries
-- attempted longest since first, so one that keeps failing goes to the back; Check now, at most once a
-- minute.
create table bibliography_entry_attempt (
  entry_id uuid primary key,
  entry_kind text not null default 'bibliographyEntry' check (entry_kind = 'bibliographyEntry'),
  last_attempt_at timestamptz not null default now(),
  foreign key (entry_id, entry_kind) references artifact (id, kind) on delete cascade
);

-- Who was told of an entry's outcome and when (XR-G): told again only thirty days on, however often
-- the outcome flaps meanwhile.
create table bibliography_entry_told (
  entry_id uuid not null,
  entry_kind text not null default 'bibliographyEntry' check (entry_kind = 'bibliographyEntry'),
  recipient uuid not null references principal on delete cascade,
  outcome text not null check (outcome in ('retracted', 'corrected')),
  told_at timestamptz not null default now(),
  primary key (entry_id, recipient, outcome),
  foreign key (entry_id, entry_kind) references artifact (id, kind) on delete cascade
);

do $$
begin
  execute format('revoke insert, update, delete, truncate on bibliography_entry_attempt from %I', current_schema());
  execute format(
    'grant select, insert (entry_id, last_attempt_at), update (last_attempt_at) on bibliography_entry_attempt to %I',
    current_schema()
  );
  execute format('revoke insert, update, delete, truncate on bibliography_entry_told from %I', current_schema());
  execute format(
    'grant select, insert (entry_id, recipient, outcome, told_at), update (told_at) on bibliography_entry_told to %I',
    current_schema()
  );
end
$$;
