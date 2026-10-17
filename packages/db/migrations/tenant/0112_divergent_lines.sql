-- Divergent lines (LIF-044 to LIF-046; the R16 plan, R16-A to R16-H; ADR-0063): a component's second
-- head of revisions, begun from a designated revision, numbered below the main line, and its own
-- workflow and scope.

set constraints all immediate;

-- A line: its place among the artifact's lines (its ordinal, negated, is its versions' revision_no),
-- its name, the designated revision it diverged from, and who and when.
create table artifact_line (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null,
  kind text not null check (kind = 'component'),
  ordinal integer not null check (ordinal >= 1),
  name text not null check (char_length(name) between 1 and 80 and name = btrim(name)),
  diverged_from uuid not null references revision_designation (version_id) on delete restrict,
  by uuid not null references principal on delete restrict,
  at timestamptz not null default now(),
  written_by xid8 not null default pg_current_xact_id(),
  foreign key (artifact_id, kind) references artifact (id, kind) on delete restrict,
  constraint artifact_line_ordinal unique (artifact_id, ordinal),
  constraint artifact_line_name unique (artifact_id, name)
);

-- A line brought back and closed (R16-F, R16-G), once.
create table line_closed (
  line_id uuid primary key references artifact_line on delete restrict,
  by uuid not null references principal on delete restrict,
  at timestamptz not null default now(),
  written_by xid8 not null default pg_current_xact_id()
);

-- What bringing it back carried across and left behind, block by block, and the main-line version
-- it made (R16-F).
create table line_return (
  line_id uuid primary key references line_closed on delete restrict,
  from_version uuid not null references artifact_version on delete restrict,
  into_version uuid not null references artifact_version on delete restrict,
  carried jsonb not null check (jsonb_typeof(carried) = 'array'),
  left_behind jsonb not null check (jsonb_typeof(left_behind) = 'array'),
  written_by xid8 not null default pg_current_xact_id()
);

-- A version's line, none for the main line, and a line's versions numbered below the main line's
-- (ADR-0063): the check replaces revision_no >= 0.
alter table artifact_version add column line_id uuid references artifact_line on delete restrict;
alter table artifact_version drop constraint artifact_version_revision_no_check;
alter table artifact_version add constraint artifact_version_line_numbered check (
  (line_id is null and revision_no >= 0) or (line_id is not null and revision_no < 0)
);

-- A line's moves are its own (R16-C): a row follows the newest of its artifact and line.
alter table workflow_transition add column line_id uuid references artifact_line on delete restrict;
create index workflow_transition_line on workflow_transition (artifact_id, line_id, id desc);
create or replace function workflow_transition_follows() returns trigger
language plpgsql as $$
declare
  previous text;
begin
  execute format(
    'select to_state from %I.workflow_transition where artifact_id = $1 and line_id is not distinct from $2 order by id desc limit 1',
    tg_table_schema
  ) into previous using new.artifact_id, new.line_id;
  if new.from_state is distinct from previous then
    raise exception 'workflow_transition: % is in %, not %', new.artifact_id, previous, new.from_state;
  end if;
  return new;
end
$$;

-- A line's scope is its own (R16-C).
alter table artifact_scope add column line_id uuid references artifact_line on delete restrict;

do $$
begin
  execute format('revoke insert, update, delete, truncate on artifact_line from %I', current_schema());
  execute format(
    'grant insert (artifact_id, kind, ordinal, name, diverged_from, by) on artifact_line to %I',
    current_schema()
  );
  execute format('grant select on artifact_line to %I', current_schema());
  execute format('revoke insert, update, delete, truncate on line_closed from %I', current_schema());
  execute format('grant insert (line_id, by) on line_closed to %I', current_schema());
  execute format('grant select on line_closed to %I', current_schema());
  execute format('revoke insert, update, delete, truncate on line_return from %I', current_schema());
  execute format(
    'grant insert (line_id, from_version, into_version, carried, left_behind) on line_return to %I',
    current_schema()
  );
  execute format('grant select on line_return to %I', current_schema());
  execute format('grant insert (line_id) on workflow_transition to %I', current_schema());
  execute format('grant insert (line_id) on artifact_scope to %I', current_schema());
end
$$;

-- The kinds gain line.diverged (LIF-044). The check is the domain's list again.
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
      'generation.discarded',
      'generation.run',
      'group.deleted',
      'group.made',
      'group.member_added',
      'group.member_removed',
      'hold.applied',
      'hold.removed',
      'import.restored',
      'invitation.accepted',
      'invitation.sent',
      'invitation.withdrawn',
      'library.changed',
      'line.diverged',
      'line.merged',
      'lock.taken',
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
