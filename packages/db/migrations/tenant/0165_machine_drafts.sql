-- Machine drafts (docs/design/translation.md, "Machine drafts"; the XL plan, XL-H to XL-K): a run may
-- translate, routed as any purpose; a version a machine drafted is marked, with the runs that made it
-- and the terms it did not translate by their labels, until a person with approve accepts its line;
-- and whether content is sent to machine translation at all.

set constraints all immediate;

alter table model_route drop constraint model_route_purpose_check;
alter table model_route add constraint model_route_purpose_check
  check (purpose in ('drafting', 'chat', 'summarising', 'embedding', 'translate'));
alter table generation_run drop constraint generation_run_purpose_check;
alter table generation_run add constraint generation_run_purpose_check
  check (purpose in ('drafting', 'chat', 'summarising', 'embedding', 'translate', 'test', 'trial'));

create table machine_draft (
  version_id uuid primary key references artifact_version on delete restrict,
  line_id uuid not null references artifact_line on delete restrict,
  -- The runs its pieces were translated by, in order: each a generation_run of this tenant's.
  runs uuid[] not null check (cardinality(runs) between 1 and 1000),
  -- The terms the draft did not translate by one of their labels (XL-J), by term identity.
  missed_terms text[] not null default '{}' check (cardinality(missed_terms) <= 1000),
  by uuid not null references principal on delete restrict,
  at timestamptz not null default now(),
  accepted_by uuid references principal on delete restrict,
  accepted_at timestamptz,
  constraint machine_draft_accepted check ((accepted_by is null) = (accepted_at is null))
);
create index machine_draft_open on machine_draft (line_id) where accepted_at is null;

-- Whether content goes to machine translation, and to which endpoints (LOC-026): off by default.
alter table translation_policy add column machine text not null default 'off'
  check (machine in ('off', 'inside', 'any'));

do $$
begin
  execute format('revoke insert, update, delete, truncate on machine_draft from %I', current_schema());
  execute format(
    'grant select, insert (version_id, line_id, runs, missed_terms, by), update (accepted_by, accepted_at) on machine_draft to %I',
    current_schema()
  );
  execute format('grant update (machine) on translation_policy to %I', current_schema());
end
$$;

-- The kinds gain translation.machine_accepted. The check is the domain's list again.
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
      'translation.job_decided',
      'translation.job_returned',
      'translation.job_sent',
      'translation.machine_accepted',
      'translation.marked_current',
      'webhook.changed',
      'workflow.defined',
      'workflow.transitioned'
    )
);
