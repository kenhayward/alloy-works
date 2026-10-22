-- Imports (docs/design/import.md; the IM plan, IM-A to IM-F; ADR-0069): a Word, Markdown or HTML
-- file read by the worker into a proposal held apart from the space, seen by its importer and the
-- space's administrators, until accepted into a document or abandoned. `awaiting` its bytes, then
-- `reading`, `proposed`, and `accepted`, `abandoned` or `failed`; an abandoned or failed one keeps its
-- row, its failure by code, and loses its parts and its file. The file is the tenant's store's, by its
-- hash; `object_key` is cleared when it is removed.
create table import (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references space,
  importer uuid not null references principal,
  file_name text not null check (length(file_name) between 1 and 255),
  file_type text not null check (file_type in ('docx', 'markdown', 'html')),
  object_key text,
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  bytes bigint check (bytes is null or bytes >= 0),
  kind text not null default 'first' check (kind in ('first', 'again')),
  state text not null default 'awaiting'
    check (state in ('awaiting', 'reading', 'proposed', 'accepted', 'abandoned', 'failed')),
  -- The heading levels it breaks out at (IM-D), the importer's to change.
  levels jsonb not null default '{"section": 1, "component": 2}'
    check (jsonb_typeof(levels) = 'object'),
  -- What the reader found the document's title and language to be, where it did.
  title text,
  language text,
  -- What was left out or kept differently (IMP-007): the admission report's entries, each with its part.
  report jsonb check (report is null or jsonb_typeof(report) = 'array'),
  failure text check (failure is null or failure ~ '^[a-z][a-z0-9_]{0,63}$'),
  document_id uuid references artifact on delete set null,
  created_at timestamptz not null default now(),
  -- When it last changed: what the 30-day sweep counts from; and when its importer was told.
  touched_at timestamptz not null default now(),
  warned_at timestamptz,
  finished_at timestamptz,
  constraint import_failure check ((state = 'failed') = (failure is not null)),
  constraint import_document check (document_id is null or state = 'accepted')
);
create index import_space on import (space_id, created_at desc, id desc);
create index import_hash on import (sha256) where object_key is not null;

-- Its parts (IM-A, IM-D): two sets of rows, the proposal as read and the one the importer edits (IMb),
-- so what was accepted unchanged can be counted (IMP-031). The read set is never changed: a trigger
-- refuses it. A section holds no blocks; a component's are admitted content, its parent a section.
create table import_part (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references import on delete cascade,
  proposal text not null check (proposal in ('read', 'edited')),
  ord integer not null check (ord >= 0),
  kind text not null check (kind in ('section', 'component')),
  title text not null check (length(title) >= 1),
  blocks jsonb not null default '[]' check (jsonb_typeof(blocks) = 'array'),
  source text not null default '',
  reason jsonb not null check (jsonb_typeof(reason) = 'object'),
  flags text[] not null default '{}',
  parent uuid references import_part on delete cascade,
  unique (import_id, proposal, ord),
  constraint import_part_section_blocks check (kind = 'component' or blocks = '[]'::jsonb)
);
create index import_part_parent on import_part (parent);

create function import_part_read_kept() returns trigger language plpgsql as $$
begin
  if old.proposal = 'read' then
    raise exception 'The proposal as read is never changed' using errcode = 'P0001';
  end if;
  return new;
end
$$;
create trigger import_part_read_kept before update on import_part
  for each row execute function import_part_read_kept();

-- What each import made (IMP-035): a row per version, the import naming the file, its hash, when and by
-- whom. Never changed.
create table import_made (
  version_id uuid primary key references artifact_version on delete cascade,
  artifact_id uuid not null references artifact on delete cascade,
  import_id uuid not null references import
);
create index import_made_import on import_made (import_id);

do $$
begin
  execute format('revoke insert, update, delete, truncate on import from %I', current_schema());
  execute format(
    'grant select, insert (space_id, importer, file_name, file_type, levels), update (object_key, sha256, bytes, kind, state, levels, title, language, report, failure, document_id, touched_at, warned_at, finished_at) on import to %I',
    current_schema()
  );
  execute format('revoke insert, update, delete, truncate on import_part from %I', current_schema());
  execute format(
    'grant select, insert (import_id, proposal, ord, kind, title, blocks, source, reason, flags, parent), update (ord, kind, title, blocks, flags, parent), delete on import_part to %I',
    current_schema()
  );
  execute format('revoke insert, update, delete, truncate on import_made from %I', current_schema());
  execute format(
    'grant select, insert (version_id, artifact_id, import_id) on import_made to %I',
    current_schema()
  );
end
$$;

-- A proposal left 23 days (IM-F): its importer told, from nobody, that it is swept in seven; the
-- import named in its counts, never its file's name.
alter table notification
  drop constraint notification_kind,
  drop constraint notification_digest;
alter table notification
  add constraint notification_kind
    check (kind in ('mention', 'reply', 'resolution', 'round', 'digest', 'budget', 'webhook', 'reference',
                    'import')),
  add constraint notification_digest check (
    (kind in ('digest', 'budget', 'webhook', 'reference', 'import')) = (counts is not null)
    and (
      (kind = 'digest' and round_id is null and thread_id is null)
      or (kind in ('budget', 'webhook', 'import') and actor is null and round_id is null
          and thread_id is null and artifact_id is null)
      or (kind = 'reference' and actor is null and round_id is null and thread_id is null
          and artifact_id is not null)
      or (kind = 'round' and actor is not null and round_id is not null and thread_id is null
          and artifact_id is not null)
      or (kind not in ('round', 'digest', 'budget', 'webhook', 'reference', 'import')
          and actor is not null and thread_id is not null and round_id is null
          and artifact_id is not null)
    )
  );

-- The audit log's kinds gain an import accepted and one abandoned.
alter table audit_event drop constraint audit_event_kind;
alter table audit_event add constraint audit_event_kind check (
    kind in (
      'access.granted',
      'access.refused',
      'access.revoked',
      'approval.given',
      'artifact.archived',
      'artifact.deleted',
      'artifact.unarchived',
      'artifact.undeleted',
      'asset.ingested',
      'asset.refused',
      'asset.relicensed',
      'asset.replaced',
      'audit.label_erased',
      'authentication.sign_in_failed',
      'authentication.signed_in',
      'authentication.signed_out',
      'baseline.made',
      'baseline.superseded',
      'binding.accepted',
      'binding.checked',
      'binding.confirmed',
      'binding.resolved',
      'binding.revised',
      'channel.changed',
      'comment.added',
      'comment.edited',
      'component.type_changed',
      'connection.changed',
      'connection.credential_set',
      'connection.made',
      'connection.retired',
      'connection.tested',
      'content.restored',
      'content.version_cut',
      'dataset.named',
      'dates.set',
      'export.downloaded',
      'export.produced',
      'extension.changed',
      'gate.rejected',
      'generation.accepted',
      'generation.budget_set',
      'generation.discarded',
      'generation.embedding_confirmed',
      'generation.limit_set',
      'generation.run',
      'group.deleted',
      'group.made',
      'group.member_added',
      'group.member_removed',
      'guardrail.retired',
      'guardrail.set',
      'hold.applied',
      'hold.removed',
      'import.abandoned',
      'import.accepted',
      'import.restored',
      'invitation.accepted',
      'invitation.sent',
      'invitation.withdrawn',
      'library.changed',
      'line.diverged',
      'line.merged',
      'line.returned',
      'lock.taken',
      'model_endpoint.changed',
      'model_endpoint.credential_set',
      'model_endpoint.made',
      'model_endpoint.retired',
      'model_endpoint.tested',
      'model_route.set',
      'organisation.changed',
      'publication.failed',
      'publication.produced',
      'publication.requested',
      'publication.shared_accessed',
      'reference.repointed',
      'relationship.changed',
      'relationship.made',
      'relationship.removed',
      'retention.changed',
      'review.completed',
      'review.lapsed',
      'review.reopened',
      'revision.accepted',
      'revision.designated',
      'revision.effective',
      'round.closed',
      'round.opened',
      'scope.set',
      'secret.accessed',
      'section.waived',
      'service_identity.created',
      'service_identity.disabled',
      'service_identity.renamed',
      'settings.changed',
      'sign_in_route.closed',
      'sign_in_route.configured',
      'space.archived',
      'space.made',
      'space.renamed',
      'space.restored',
      'style.changed',
      'suggestion.accepted',
      'suggestion.made',
      'suggestion.rejected',
      'suggestion.withdrawn',
      'support.granted',
      'support.revoked',
      'support.used',
      'template.moved',
      'tenant.administrator_claimed',
      'tenant.administrator_named',
      'tenant.closed',
      'tenant.invited',
      'theme.moved',
      'thread.made_internal',
      'thread.resolved',
      'thread.started',
      'token.issued',
      'token.revoked',
      'token.used',
      'tool.used',
      'webhook.changed',
      'workflow.defined',
      'workflow.transitioned'
    )
);
