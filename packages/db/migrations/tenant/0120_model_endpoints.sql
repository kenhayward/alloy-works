-- Model endpoints (generation.md, "Endpoints"; the G1 plan): a tenant's endpoints, each a mutable row
-- audited at every change (G1-A), its key sealed by the connector to the endpoint and its origin
-- (G1-B, ADR-0064), each purpose routed to one (GEN-028), and every model call a run (G1-G), kept
-- whole: ended once, never changed after, never deleted (GEN-046).

create table model_endpoint (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  protocol text not null check (protocol in ('anthropic', 'openai')),
  base_url text not null check (length(base_url) <= 2048),
  model text not null check (model ~ '^[!-~]{1,200}$'),
  context_window integer not null check (context_window between 1024 and 10000000),
  -- Per million tokens, in millionths of the currency's unit (G1-A), so cost is integer arithmetic.
  price_in_micros bigint not null check (price_in_micros between 0 and 1000000000000),
  price_out_micros bigint not null check (price_out_micros between 0 and 1000000000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  -- Stated by the administrator, never inferred (GEN-031).
  boundary text not null check (boundary in ('inside', 'outside')),
  made_by uuid references principal on delete set null,
  made_at timestamptz not null default now(),
  changed_at timestamptz not null default now(),
  retired_at timestamptz
);
-- A name names one endpoint among those still in use (G1-M).
create unique index model_endpoint_name on model_endpoint (lower(name)) where retired_at is null;

-- An endpoint's keys, the latest its own; sealed to the origin it was set for, whose digest is kept
-- so a changed base URL is seen to need its key again (G1-B, G1-M).
create table model_credential (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references model_endpoint on delete restrict,
  sealed text not null,
  sealed_for text not null,
  set_by uuid references principal on delete set null,
  set_at timestamptz not null default now()
);
create index model_credential_latest on model_credential (endpoint_id, set_at desc, id desc);

-- Which endpoint each purpose goes to (GEN-028); a purpose with no row goes nowhere.
create table model_route (
  purpose text primary key check (purpose in ('drafting', 'chat', 'summarising', 'embedding')),
  endpoint_id uuid not null references model_endpoint on delete restrict,
  set_by uuid references principal on delete set null,
  set_at timestamptz not null default now()
);

create table generation_run (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('drafting', 'chat', 'summarising', 'embedding', 'test')),
  endpoint_id uuid not null references model_endpoint on delete restrict,
  -- The endpoint's settings as the run used them, copied, so no later change rewrites what it ran on.
  endpoint jsonb not null check (jsonb_typeof(endpoint) = 'object'),
  prompt_version uuid,
  parameters jsonb not null check (jsonb_typeof(parameters) = 'object'),
  -- SHA-256, hex, of the call as canonical JSON (G1-F).
  context_digest text not null check (context_digest ~ '^[0-9a-f]{64}$'),
  -- What the context resolved to, by artifact, version and block.
  context jsonb not null default '[]' check (jsonb_typeof(context) = 'array'),
  steps jsonb not null default '[]' check (jsonb_typeof(steps) = 'array'),
  requested_by uuid references principal on delete set null,
  document_id uuid,
  started_at timestamptz not null default now(),
  outcome text not null default 'running' check (outcome ~ '^[a-z_]{1,40}$'),
  -- As the reply named it, with its version where the provider gave one.
  model text,
  tokens_in integer check (tokens_in >= 0),
  tokens_out integer check (tokens_out >= 0),
  cost_micros bigint check (cost_micros >= 0),
  finished_at timestamptz,
  check ((outcome = 'running') = (finished_at is null))
);
create index generation_run_started on generation_run (started_at desc, id desc);
create index generation_run_requester on generation_run (requested_by, started_at desc);

-- A run is ended once, from running, and nothing else of it changes after; none is ever deleted
-- (GEN-046): a sweep, an erasure, nothing.
create function generation_run_kept() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'generation_run: a run is kept, never deleted';
  end if;
  -- A person deleted leaves their runs, unnamed: the one change an ended run takes.
  if new.requested_by is null and old.requested_by is not null
    and (to_jsonb(new) - 'requested_by') = (to_jsonb(old) - 'requested_by') then
    return new;
  end if;
  if old.outcome <> 'running'
    or new.id is distinct from old.id
    or new.purpose is distinct from old.purpose
    or new.endpoint_id is distinct from old.endpoint_id
    or new.endpoint is distinct from old.endpoint
    or new.prompt_version is distinct from old.prompt_version
    or new.parameters is distinct from old.parameters
    or new.context_digest is distinct from old.context_digest
    or new.context is distinct from old.context
    or new.document_id is distinct from old.document_id
    or new.started_at is distinct from old.started_at
    or (new.requested_by is distinct from old.requested_by and new.requested_by is not null) then
    raise exception 'generation_run: a run is ended once, and nothing else of it changes';
  end if;
  return new;
end
$$;
create trigger generation_run_kept before update or delete on generation_run
  for each row execute function generation_run_kept();

-- The audit log's kinds gain the endpoints' (G1-J).
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
