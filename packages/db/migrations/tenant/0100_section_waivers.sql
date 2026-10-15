-- A section the template requires, removed with a reason (TPL-029; the WF6 plan, WF6-B;
-- templates.md).

set constraints all immediate;

-- Each such removal, inserted and never changed: the document, the starting section's key, the reason,
-- the version recording the removal, who and when. A key with a row is no longer missing (TPL-013).
create table section_waiver (
  id bigint generated always as identity primary key,
  document_id uuid not null,
  document_kind text not null default 'document' check (document_kind = 'document'),
  key text not null check (key ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
  reason text not null check (char_length(btrim(reason)) between 1 and 2000),
  version_id uuid not null references artifact_version on delete restrict,
  by uuid not null references principal on delete restrict,
  at timestamptz not null default now(),
  written_by xid8 not null default pg_current_xact_id(),
  foreign key (document_id, document_kind) references artifact (id, kind) on delete restrict
);
create index section_waiver_document on section_waiver (document_id, key, id desc);

do $$
begin
  execute format('revoke insert, update, delete, truncate on section_waiver from %I', current_schema());
  execute format(
    'grant insert (document_id, key, reason, version_id, by) on section_waiver to %I',
    current_schema()
  );
  execute format('grant select on section_waiver to %I', current_schema());
end
$$;

-- The kinds gain section.waived (WF6-B). The check is the domain's list again.
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
