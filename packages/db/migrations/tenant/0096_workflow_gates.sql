-- Gates, approvals and revisions (LIF-003, LIF-008 to LIF-010, LIF-013, LIF-051, LIF-052, VER-012 to
-- VER-015; the WF2 plan, WF2-A to WF2-G; workflow.md).

set constraints all immediate;

-- Each approval or rejection at a gate, inserted and never changed (WF2-C): against the version the
-- approver saw, in the round that began with the move into the gate's from-state, which `round`
-- names. A rejection carries its reason; an approval none.
create table workflow_approval (
  id bigint generated always as identity primary key,
  artifact_id uuid not null,
  kind text not null check (kind in ('component', 'document')),
  round bigint not null references workflow_transition on delete restrict,
  version_id uuid not null references artifact_version on delete restrict,
  definition_id uuid not null,
  transition text not null check (transition ~ '^[a-z][a-z0-9_]*$'),
  decision text not null check (decision in ('approved', 'rejected')),
  reason text check (char_length(reason) between 1 and 2000),
  by uuid not null references principal on delete restrict,
  at timestamptz not null default now(),
  written_by xid8 not null default pg_current_xact_id(),
  foreign key (artifact_id, kind) references artifact (id, kind) on delete restrict,
  foreign key (definition_id, kind) references workflow_definition (id, kind) on delete restrict,
  constraint workflow_approval_reason check ((decision = 'rejected') = (reason is not null))
);
create index workflow_approval_round on workflow_approval (round, transition);

-- A revision: a designation of a version that already exists, adding no content (VER-012), made only
-- as a gate passes (VER-013), by whom, when and at which gate (VER-014), numbered from 1 per artifact
-- (VER-015). Insert-only, on the version row's terms (VER-016).
create table revision_designation (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null,
  kind text not null check (kind in ('component', 'document')),
  version_id uuid not null unique references artifact_version on delete restrict,
  revision_no integer not null check (revision_no > 0),
  definition_id uuid not null,
  transition text not null check (transition ~ '^[a-z][a-z0-9_]*$'),
  by uuid not null references principal on delete restrict,
  at timestamptz not null default now(),
  written_by xid8 not null default pg_current_xact_id(),
  foreign key (artifact_id, kind) references artifact (id, kind) on delete restrict,
  foreign key (definition_id, kind) references workflow_definition (id, kind) on delete restrict,
  constraint revision_designation_once unique (artifact_id, revision_no)
);

do $$
begin
  execute format(
    'revoke insert, update, delete, truncate on workflow_approval from %I', current_schema()
  );
  execute format(
    'grant insert (artifact_id, kind, round, version_id, definition_id, transition, decision, reason, by) on workflow_approval to %I',
    current_schema()
  );
  execute format('grant select on workflow_approval to %I', current_schema());
  execute format(
    'revoke insert, update, delete, truncate on revision_designation from %I', current_schema()
  );
  execute format(
    'grant insert (artifact_id, kind, version_id, revision_no, definition_id, transition, by) on revision_designation to %I',
    current_schema()
  );
  execute format('grant select on revision_designation to %I', current_schema());
end
$$;

-- The seed's version 2 (WF2-B), only where a kind's newest is still version 1, the seed: Approve a
-- gate of one approver, not an author, rejecting to Draft as Return; Return no transition of its own.
-- An edited workflow is the tenant's, and gains no gate.
insert into workflow_definition (kind, version_no, body)
select d.kind, 2, '{
  "states": [
    {"key": "draft", "name": "Draft", "initial": true, "approved": false},
    {"key": "in_review", "name": "In review", "initial": false, "approved": false},
    {"key": "approved", "name": "Approved", "initial": false, "approved": true}
  ],
  "transitions": [
    {"key": "submit", "name": "Submit", "from": "draft", "to": "in_review",
     "permission": "edit", "reasonRequired": false},
    {"key": "approve", "name": "Approve", "from": "in_review", "to": "approved",
     "permission": "approve", "reasonRequired": false,
     "gate": {"approvals": 1, "notAuthor": true, "reject": {"name": "Return", "to": "draft"},
              "designates": true, "baseline": false, "publication": "none"}},
    {"key": "reopen", "name": "Reopen", "from": "approved", "to": "draft",
     "permission": "edit", "reasonRequired": true}
  ]
}'::jsonb
from workflow_definition d
where d.version_no = 1
  and not exists (select 1 from workflow_definition n where n.kind = d.kind and n.version_no > 1);

-- The kinds lose approval.rejected, a rejection being the gate's (WF2-G). The check is the domain's
-- list again.
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
