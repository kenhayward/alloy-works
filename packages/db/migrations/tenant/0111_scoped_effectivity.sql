-- Revisions effective by scope (LIF-042, LIF-043, LIF-047; the R15 plan, R15-A to R15-E;
-- workflow.md, "Scopes"): a scope is a condition axis value.

set constraints all immediate;

-- A component's or document's scope, as acts (R15-B): the axis values its next revision is effective
-- for, each with the party who must accept it there; inserted and never changed, the latest row its
-- scope now. An empty list is everywhere. Its shape is the domain's `scopeSchema`.
create table artifact_scope (
  id bigint generated always as identity primary key,
  artifact_id uuid not null,
  kind text not null check (kind in ('component', 'document')),
  scope jsonb not null check (jsonb_typeof(scope) = 'array'),
  by uuid not null references principal on delete restrict,
  at timestamptz not null default now(),
  written_by xid8 not null default pg_current_xact_id(),
  foreign key (artifact_id, kind) references artifact (id, kind) on delete restrict
);
create index artifact_scope_latest on artifact_scope (artifact_id, id desc);

-- A designated revision's scope, fixed as the gate passed: one row a value; none is everywhere.
create table revision_scope (
  version_id uuid not null references revision_designation (version_id) on delete restrict,
  artifact_id uuid not null,
  axis text not null check (axis ~ '^[a-z][a-z0-9_]{0,63}$'),
  value text not null check (value ~ '^[a-z][a-z0-9_]{0,63}$'),
  party_principal uuid references principal on delete restrict,
  party_group uuid references access_group on delete restrict,
  primary key (version_id, axis, value),
  constraint revision_scope_party check (party_principal is null or party_group is null)
);
create index revision_scope_artifact on revision_scope (artifact_id);

-- Its acceptance in one scope by its party (R15-E), once.
create table revision_acceptance (
  version_id uuid not null,
  axis text not null,
  value text not null,
  by uuid not null references principal on delete restrict,
  at timestamptz not null default now(),
  written_by xid8 not null default pg_current_xact_id(),
  primary key (version_id, axis, value),
  foreign key (version_id, axis, value) references revision_scope on delete restrict
);

do $$
begin
  execute format('revoke insert, update, delete, truncate on artifact_scope from %I', current_schema());
  execute format('grant insert (artifact_id, kind, scope, by) on artifact_scope to %I', current_schema());
  execute format('grant select on artifact_scope to %I', current_schema());
  execute format('revoke insert, update, delete, truncate on revision_scope from %I', current_schema());
  execute format(
    'grant insert (version_id, artifact_id, axis, value, party_principal, party_group) on revision_scope to %I',
    current_schema()
  );
  execute format('grant select on revision_scope to %I', current_schema());
  execute format('revoke insert, update, delete, truncate on revision_acceptance from %I', current_schema());
  execute format('grant insert (version_id, axis, value, by) on revision_acceptance to %I', current_schema());
  execute format('grant select on revision_acceptance to %I', current_schema());
end
$$;

-- The kinds gain scope.set and revision.accepted (R15). The check is the domain's list again.
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
