-- Suggestions (collaboration.md, Suggestions; the SG plan, SG-A; ADR-0058, ADR-0059): a reviewer's draft
-- of a component kept beside it, never in its content; resolved once - accepted, rejected or withdrawn
-- - and never deleted.

create table suggestion (
  id uuid primary key default gen_random_uuid(),
  component_id uuid not null,
  component_kind text not null default 'component'
    constraint suggestion_component_kind check (component_kind = 'component'),
  -- The version it was made against (COL-021), of that component.
  made_against uuid not null,
  -- The draft whole, as the content schema reads it, and its digest: a second send of one draft
  -- finds the first (SG-A).
  proposed jsonb not null constraint suggestion_proposed check (jsonb_typeof(proposed) = 'object'),
  proposed_digest text not null constraint suggestion_proposed_digest check (proposed_digest ~ '^[0-9a-f]{64}$'),
  made_by uuid not null references principal on delete restrict,
  made_at timestamptz not null default now(),
  foreign key (component_id, component_kind) references artifact (id, kind) on delete restrict,
  foreign key (made_against, component_id, component_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict,
  constraint suggestion_once unique (component_id, made_by, made_against, proposed_digest)
);
create index suggestion_component on suggestion (component_id, made_at, id);

-- Resolved once (COL-022, COL-048): accepted with the version it stands in, rejected or withdrawn.
create table suggestion_resolution (
  suggestion_id uuid primary key references suggestion on delete restrict,
  act text not null constraint suggestion_resolution_act check (act in ('accepted', 'rejected', 'withdrawn')),
  -- For an acceptance, the version the merge stands in: the one it cut, or the current one where the
  -- merge changed nothing (SG-G).
  version_id uuid references artifact_version on delete restrict,
  resolved_by uuid not null references principal on delete restrict,
  resolved_at timestamptz not null default now(),
  constraint suggestion_resolution_version check ((act = 'accepted') = (version_id is not null))
);

-- Inserted and read: nothing changes or removes a suggestion or its resolution.
do $$
begin
  execute format(
    'revoke update, delete, truncate on suggestion, suggestion_resolution from %I',
    current_schema()
  );
end
$$;

-- The kinds the SG plan adds: a suggestion made and withdrawn. The check is the domain's list again.
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
      'revision.designated',
      'revision.effective',
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
      'workflow.transitioned'
    )
  );
