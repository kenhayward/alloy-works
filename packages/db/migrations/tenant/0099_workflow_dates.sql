-- Effective and review-by dates (LIF-015 to LIF-018, LIF-059, LIF-060; the WF5 plan, WF5-A to
-- WF5-G; workflow.md).

set constraints all immediate;

-- A component's or document's dates, as acts (WF5-A): inserted and never changed, the latest row its
-- dates now. The effective instant keeps the offset it was set in (LIF-062); review by is a day.
create table artifact_dates (
  id bigint generated always as identity primary key,
  artifact_id uuid not null,
  kind text not null check (kind in ('component', 'document')),
  effective_at timestamptz,
  effective_offset integer check (effective_offset between -1080 and 1080),
  review_by date,
  owner uuid references principal on delete restrict,
  by uuid not null references principal on delete restrict,
  at timestamptz not null default now(),
  written_by xid8 not null default pg_current_xact_id(),
  foreign key (artifact_id, kind) references artifact (id, kind) on delete restrict,
  constraint artifact_dates_offset check ((effective_at is null) = (effective_offset is null))
);
create index artifact_dates_latest on artifact_dates (artifact_id, id desc);

-- A revision approved to take effect later (WF5-B): its date fixed as the gate passed.
create table revision_effective (
  version_id uuid primary key references revision_designation (version_id) on delete restrict,
  artifact_id uuid not null,
  effective_at timestamptz not null,
  written_by xid8 not null default pg_current_xact_id()
);
create index revision_effective_artifact on revision_effective (artifact_id);

-- Its taking effect, recorded once by the sweep (WF5-D).
create table revision_effected (
  version_id uuid primary key references revision_effective on delete restrict,
  at timestamptz not null default now(),
  written_by xid8 not null default pg_current_xact_id()
);

-- A review date passing unmet, acted on once (WF5-G): what the workflow declared it does.
create table review_lapse (
  id bigint generated always as identity primary key,
  artifact_id uuid not null,
  kind text not null check (kind in ('component', 'document')),
  review_by date not null,
  action text not null check (action in ('visibility', 'move', 'escalate')),
  escalated_to uuid references principal on delete restrict,
  at timestamptz not null default now(),
  written_by xid8 not null default pg_current_xact_id(),
  foreign key (artifact_id, kind) references artifact (id, kind) on delete restrict,
  constraint review_lapse_once unique (artifact_id, review_by),
  constraint review_lapse_escalated check ((action = 'escalate') = (escalated_to is not null))
);

do $$
begin
  execute format('revoke insert, update, delete, truncate on artifact_dates from %I', current_schema());
  execute format(
    'grant insert (artifact_id, kind, effective_at, effective_offset, review_by, owner, by) on artifact_dates to %I',
    current_schema()
  );
  execute format('grant select on artifact_dates to %I', current_schema());
  execute format('revoke insert, update, delete, truncate on revision_effective from %I', current_schema());
  execute format(
    'grant insert (version_id, artifact_id, effective_at) on revision_effective to %I',
    current_schema()
  );
  execute format('grant select on revision_effective to %I', current_schema());
  execute format('revoke insert, update, delete, truncate on revision_effected from %I', current_schema());
  execute format('grant insert (version_id) on revision_effected to %I', current_schema());
  execute format('grant select on revision_effected to %I', current_schema());
  execute format('revoke insert, update, delete, truncate on review_lapse from %I', current_schema());
  execute format(
    'grant insert (artifact_id, kind, review_by, action, escalated_to) on review_lapse to %I',
    current_schema()
  );
  execute format('grant select on review_lapse to %I', current_schema());
end
$$;

-- The kinds gain dates.set and review.lapsed (WF5-A, WF5-G). The check is the domain's list again.
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
