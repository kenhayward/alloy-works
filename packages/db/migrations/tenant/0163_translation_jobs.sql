-- Translation jobs (docs/design/translation.md, "Translation jobs"; the XL plan, XL-D, XL-E): a
-- document's components sent to one language as one XLIFF file, each item what was sent - the source
-- version and the line's head as they stood - and, from XLb, what came back. The file is written from
-- the versions named whenever it is downloaded, so nothing of it is stored.

set constraints all immediate;

create table translation_job (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references artifact on delete restrict,
  document_version uuid not null references artifact_version on delete restrict,
  language text not null check (char_length(language) between 2 and 35),
  vendor text check (vendor is null or char_length(vendor) between 1 and 200),
  by uuid not null references principal on delete restrict,
  at timestamptz not null default now(),
  closed_by uuid references principal on delete restrict,
  closed_at timestamptz,
  constraint translation_job_closed check ((closed_by is null) = (closed_at is null))
);
create index translation_job_document on translation_job (document_id, at desc);

-- One component a job lists (XL-D): sent on its language line, from a source version, or not sent
-- and why. What came back (XL-F, XL-G) is the outcome, the version it made, and who decided.
create table translation_job_item (
  job_id uuid not null references translation_job on delete restrict,
  component_id uuid not null references artifact on delete restrict,
  -- Where the document placed it, first at 0: the job lists its components in that order.
  position int not null check (position >= 0),
  line_id uuid references artifact_line on delete restrict,
  source_version uuid references artifact_version on delete restrict,
  line_head uuid references artifact_version on delete restrict,
  not_sent text check (not_sent in ('needs_revision', 'not_editable')),
  outcome text check (outcome in ('returned', 'held', 'refused')),
  version_id uuid references artifact_version on delete restrict,
  decided_by uuid references principal on delete restrict,
  decided_at timestamptz,
  primary key (job_id, component_id),
  -- Sent, with its line and source, or not sent, with neither.
  constraint translation_job_item_sent check (
    (not_sent is null) = (line_id is not null and source_version is not null)
  ),
  constraint translation_job_item_decided check (
    (outcome is null) = (decided_at is null) and (decided_by is null) = (decided_at is null)
  )
);
create index translation_job_item_line on translation_job_item (line_id) where outcome is null;

do $$
begin
  execute format('revoke insert, update, delete, truncate on translation_job from %I', current_schema());
  execute format(
    'grant insert (id, document_id, document_version, language, vendor, by) on translation_job to %I',
    current_schema()
  );
  execute format('grant update (closed_by, closed_at) on translation_job to %I', current_schema());
  execute format('grant select on translation_job to %I', current_schema());
  execute format('revoke insert, update, delete, truncate on translation_job_item from %I', current_schema());
  execute format(
    'grant insert (job_id, component_id, position, line_id, source_version, line_head, not_sent) on translation_job_item to %I',
    current_schema()
  );
  execute format(
    'grant update (outcome, version_id, decided_by, decided_at) on translation_job_item to %I',
    current_schema()
  );
  execute format('grant select on translation_job_item to %I', current_schema());
end
$$;

-- The kinds gain translation.job_sent and translation.job_closed. The check is the domain's list again.
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
      'translation.declared',
      'translation.job_closed',
      'translation.job_sent',
      'translation.marked_current',
      'webhook.changed',
      'workflow.defined',
      'workflow.transitioned'
    )
);
