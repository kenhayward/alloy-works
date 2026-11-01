-- What an image is held to on its way in and on its way out (assets.md; the AL plan, AL-G, AL-H, AL-I).

-- The most bytes an image of each format may be in this environment (AST-004): null for the format's
-- own limit, `ADMITTED_FORMATS` in the domain, which this repeats; lowered, never raised.
alter table images_policy
  add column limits jsonb not null default '{"png": null, "jpeg": null}'::jsonb,
  add constraint images_policy_limits check (
    jsonb_typeof(limits) = 'object'
    and limits ? 'png' and limits ? 'jpeg' and limits - 'png' - 'jpeg' = '{}'::jsonb
    and (jsonb_typeof(limits -> 'png') = 'null'
      or (jsonb_typeof(limits -> 'png') = 'number' and (limits ->> 'png')::numeric between 1024 and 25000000
        and (limits ->> 'png')::numeric = trunc((limits ->> 'png')::numeric)))
    and (jsonb_typeof(limits -> 'jpeg') = 'null'
      or (jsonb_typeof(limits -> 'jpeg') = 'number' and (limits ->> 'jpeg')::numeric between 1024 and 25000000
        and (limits ->> 'jpeg')::numeric = trunc((limits ->> 'jpeg')::numeric)))
  );

-- What each image a publication printed carried that its outputs do not (AST-007, AST-024; AL-G):
-- the domain's `MetadataFound`, sorted, empty where it carried nothing. Null for a publication made
-- before this, which printed its images as they were uploaded.
alter table publication_asset
  add column stripped text[] check (
    stripped <@ array['comment', 'credentials', 'exif', 'gps', 'iptc', 'other', 'text', 'xmp']
  );

-- An image's derivatives (AST-008, AST-010, AST-048; AL-H): a thumbnail and a preview of one version,
-- WebP, turned upright, made by the `derive` job from the original's stripped bytes. Keyed by version,
-- so a version is never served another's. Never the only copy of anything: the original is kept, and a
-- derivative is discarded by deleting its row and made again from it.
create table asset_derivative (
  version_id uuid not null,
  asset_id uuid not null,
  asset_kind text not null default 'asset' check (asset_kind = 'asset'),
  kind text not null check (kind in ('thumbnail', 'preview')),
  object_key text not null check (object_key ~ '/sha256/[0-9a-f]{64}$'),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  bytes integer not null check (bytes > 0),
  -- What the original carried that the derivative does not (AST-007), as on `publication_asset`.
  stripped text[] not null check (
    stripped <@ array['comment', 'credentials', 'exif', 'gps', 'iptc', 'other', 'text', 'xmp']
  ),
  made_at timestamptz not null default clock_timestamp(),
  primary key (version_id, kind),
  foreign key (version_id, asset_id, asset_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict
);
create index asset_derivative_object on asset_derivative (object_key);

-- A version whose derivatives were asked for and not yet made, so a read asks the job once however
-- often it is read (pre-flight 5). The job removes it.
create table asset_derivative_wanted (
  version_id uuid primary key,
  wanted_at timestamptz not null default clock_timestamp()
);

do $$
begin
  execute format('grant update (limits) on images_policy to %I', current_schema());
  execute format('revoke update, truncate on asset_derivative, asset_derivative_wanted from %I',
    current_schema());
end
$$;

-- The kinds gain asset.derivatives_discarded (AST-048). The check is the domain's list again.
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
      'asset.derivatives_discarded',
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
      'bridge.delivered',
      'bridge.refused',
      'bridge.settings_changed',
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
