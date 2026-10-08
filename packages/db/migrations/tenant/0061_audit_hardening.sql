-- The AU1 final review: erasure's search path pinned, and anonymous sign-in failures throttled.

-- `erase_labels` runs as the schema's owner, so it resolves names in this schema alone and then
-- pg_temp, which is last, so nothing a session creates can stand in for a table it names (L8).
do $$
begin
  execute format(
    'alter function erase_labels(uuid) set search_path = %I, pg_temp',
    current_schema()
  );
end
$$;

-- A provider failure naming nobody is recorded at most once a minute per route and failure, its
-- event counting the failures since the last (H1; as a token's use is throttled, AU1-G): an
-- unauthenticated caller cannot write events without limit. One row per route and failure, held
-- `FOR UPDATE` by the upsert that counts, so two failures at once take turns.
create table sign_in_failure_tally (
  route text not null check (route in ('organisation', 'google')),
  failure text not null,
  pending integer not null default 0 check (pending >= 0),
  recorded_at timestamptz,
  primary key (route, failure)
);
do $$
begin
  execute format('revoke delete, truncate on sign_in_failure_tally from %I', current_schema());
end
$$;

-- The kinds the AU1 review added (M4): one for each requirement saying its act is audited that no
-- kind named, declared for the design that builds the act. The check is the domain's list again.
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
      'suggestion.rejected',
      'support.granted',
      'support.revoked',
      'support.used',
      'template.moved',
      'tenant.administrator_claimed',
      'tenant.administrator_named',
      'tenant.closed',
      'tenant.invited',
      'theme.moved',
      'token.issued',
      'token.revoked',
      'token.used',
      'tool.used',
      'webhook.changed',
      'workflow.transitioned'
    )
  );
