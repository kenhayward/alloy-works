-- Workflow (LIF-001, LIF-002, LIF-007, LIF-061; the WF1 plan, WF-A to WF-K; workflow.md): every
-- component and document in exactly one state of its kind's workflow, declared per tenant, versioned.

-- An earlier migration's deferred checks on artifact_version may still be pending in this
-- transaction, and Postgres alters no table with one; so they fire here, as 0090 does.
set constraints all immediate;

-- Each kind's definition, a version per save, inserted and never changed (WF-B): the newest is in
-- force. Version 1 is the seed, by nobody.
create table workflow_definition (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('component', 'document')),
  version_no integer not null check (version_no > 0),
  body jsonb not null check (jsonb_typeof(body) = 'object'),
  by uuid references principal on delete restrict,
  at timestamptz not null default now(),
  written_by xid8 not null default pg_current_xact_id(),
  constraint workflow_definition_once unique (kind, version_no),
  constraint workflow_definition_kind unique (id, kind)
);

-- Each move, inserted and never changed (WF-D): the latest row is the state, and the definition it
-- moved under; a component never moves under the document workflow. The first row of each artifact
-- has no transition and no from; a creation's names no version, which does not exist yet, and a
-- save of an approved one names the version it cut, with no transition. By nobody where 0095 wrote
-- it for an author unknown.
create table workflow_transition (
  id bigint generated always as identity primary key,
  artifact_id uuid not null,
  kind text not null check (kind in ('component', 'document')),
  version_id uuid references artifact_version on delete restrict,
  transition text check (transition ~ '^[a-z][a-z0-9_]*$'),
  from_state text check (from_state ~ '^[a-z][a-z0-9_]*$'),
  to_state text not null check (to_state ~ '^[a-z][a-z0-9_]*$'),
  definition_id uuid not null,
  reason text check (char_length(reason) between 1 and 2000),
  by uuid references principal on delete restrict,
  at timestamptz not null default now(),
  written_by xid8 not null default pg_current_xact_id(),
  foreign key (artifact_id, kind) references artifact (id, kind) on delete restrict,
  foreign key (definition_id, kind) references workflow_definition (id, kind) on delete restrict,
  constraint workflow_transition_from check (from_state is not null or transition is null),
  constraint workflow_transition_reason check (reason is null or transition is not null)
);
create index workflow_transition_latest on workflow_transition (artifact_id, id desc);

-- A row's from is the state before it, and the first row has none: no state changes without a row.
create function workflow_transition_follows() returns trigger
language plpgsql as $$
declare
  previous text;
begin
  execute format(
    'select to_state from %I.workflow_transition where artifact_id = $1 order by id desc limit 1',
    tg_table_schema
  ) into previous using new.artifact_id;
  if new.from_state is distinct from previous then
    raise exception 'workflow_transition: % is in %, not %', new.artifact_id, previous, new.from_state;
  end if;
  return new;
end
$$;

create trigger workflow_transition_follows before insert on workflow_transition
  for each row execute function workflow_transition_follows();

do $$
begin
  execute format(
    'revoke insert, update, delete, truncate on workflow_definition from %I', current_schema()
  );
  execute format(
    'grant insert (kind, version_no, body, by) on workflow_definition to %I', current_schema()
  );
  execute format('grant select on workflow_definition to %I', current_schema());
  execute format(
    'revoke insert, update, delete, truncate on workflow_transition from %I', current_schema()
  );
  execute format(
    'grant insert (artifact_id, kind, version_id, transition, from_state, to_state, definition_id, reason, by) on workflow_transition to %I',
    current_schema()
  );
  execute format('grant select on workflow_transition to %I', current_schema());
end
$$;

-- The seed (WF-C), for each kind: draft, in review, approved. Return and Approve need approve.
insert into workflow_definition (kind, version_no, body)
select kind, 1, '{
  "states": [
    {"key": "draft", "name": "Draft", "initial": true, "approved": false},
    {"key": "in_review", "name": "In review", "initial": false, "approved": false},
    {"key": "approved", "name": "Approved", "initial": false, "approved": true}
  ],
  "transitions": [
    {"key": "submit", "name": "Submit", "from": "draft", "to": "in_review",
     "permission": "edit", "reasonRequired": false},
    {"key": "return", "name": "Return", "from": "in_review", "to": "draft",
     "permission": "approve", "reasonRequired": true},
    {"key": "approve", "name": "Approve", "from": "in_review", "to": "approved",
     "permission": "approve", "reasonRequired": false},
    {"key": "reopen", "name": "Reopen", "from": "approved", "to": "draft",
     "permission": "edit", "reasonRequired": true}
  ]
}'::jsonb
from (values ('component'), ('document')) k(kind);

-- Every component and document there is starts in draft, under version 1, at its latest version.
insert into workflow_transition (artifact_id, kind, version_id, to_state, definition_id, by)
select a.id, a.kind, latest.id, 'draft', d.id, first.author_id
from artifact a
join workflow_definition d on d.kind = a.kind and d.version_no = 1
left join lateral (select v.id from artifact_version v where v.artifact_id = a.id
                   order by v.revision_no desc, v.version_no desc limit 1) latest on true
left join lateral (select v.author_id from artifact_version v where v.artifact_id = a.id
                   order by v.revision_no, v.version_no limit 1) first on true
where a.kind in ('component', 'document')
order by a.id;

-- Search narrows by it (WF-H): the artifact's state, as archived is, on its current rows and its
-- history, a section's its document's; not on earlier versions' rows, so a baseline filters on now.
alter table search_entry add column workflow_state text;
update search_entry set workflow_state = 'draft' where kind in ('component', 'document', 'section');
create index search_entry_workflow_state on search_entry (workflow_state);
alter table search_history add column workflow_state text;
update search_history set workflow_state = 'draft';
create index search_history_workflow_state on search_history (workflow_state);

-- The kinds gain workflow.defined, and workflow.transitioned is emitted. The check is the domain's
-- list again.
alter table audit_event drop constraint audit_event_kind;
alter table audit_event add constraint audit_event_kind check (
    kind in (
      'access.granted',
      'access.refused',
      'access.revoked',
      'approval.given',
      'approval.rejected',
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
      'review.reopened',
      'revision.designated',
      'revision.effective',
      'round.closed',
      'round.opened',
      'secret.accessed',
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

set constraints all deferred;
