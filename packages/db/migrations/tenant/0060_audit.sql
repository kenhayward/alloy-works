-- The tenant's audit log (audit.md; the AU1 plan, AU1-B and AU1-C): one insert-only row per event,
-- and the labels that keep it readable once what it names is gone. No foreign key to anything an event
-- describes: the subject, the actor and the space may go, and the event stays (LIF-029).
create table audit_event (
  -- Order is the sequence's, never the clock's (LIF-032); a rolled-back act leaves a gap.
  sequence bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- The transaction that wrote it, so a reader bounds a page by its snapshot's xmin and never passes
  -- a sequence taken by a transaction that commits after it (audit.md, "Order").
  xact xid8 not null default pg_current_xact_id(),
  kind text not null,
  actor_kind text not null
    check (actor_kind in ('person', 'token', 'system', 'vendor', 'anonymous')),
  actor uuid,
  token uuid,
  subject_kind text,
  subject uuid,
  subject_version uuid,
  space uuid,
  outcome text not null check (outcome in ('done', 'refused')),
  -- Strict per kind, checked in the domain (LIF-030).
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object'),
  trace_id text,
  -- A person acts by session or by token, and is named; nobody else is.
  constraint audit_event_actor check ((actor_kind in ('person', 'token')) = (actor is not null)),
  constraint audit_event_token check ((actor_kind = 'token') = (token is not null)),
  -- The closed list in packages/domain/src/audit/kinds.ts, which a test holds this to.
  constraint audit_event_kind check (
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
      'invitation.accepted',
      'invitation.sent',
      'invitation.withdrawn',
      'lock.taken',
      'publication.failed',
      'publication.produced',
      'publication.requested',
      'publication.shared_accessed',
      'reference.repointed',
      'relationship.changed',
      'relationship.made',
      'relationship.removed',
      'revision.designated',
      'settings.changed',
      'sign_in_route.closed',
      'sign_in_route.configured',
      'space.archived',
      'space.made',
      'space.renamed',
      'space.restored',
      'suggestion.accepted',
      'suggestion.rejected',
      'support.granted',
      'support.revoked',
      'support.used',
      'template.moved',
      'tenant.administrator_claimed',
      'tenant.administrator_named',
      'tenant.invited',
      'token.issued',
      'token.revoked',
      'token.used',
      'tool.used',
      'workflow.transitioned'
    )
  )
);

-- The names and titles an event needs once its originals are gone (audit.md, "Labels"). `refers_to`
-- is the principal or thing a label names, so an erasure finds every label of a person.
create table audit_label (
  sequence bigint not null references audit_event,
  role text not null,
  text text not null,
  refers_to uuid,
  erased_at timestamptz,
  primary key (sequence, role)
);
create index audit_label_refers_to on audit_label (refers_to);

-- LIF-025 is a grant rather than a convention, as the version chain's is (0008): the tenant's runtime
-- role, which shares this schema's name, may insert and read the log and do nothing else to it.
do $$
begin
  execute format(
    'revoke update, delete, truncate on audit_event, audit_label from %I',
    current_schema()
  );
end
$$;

-- And no role, the owner's included, updates an event.
create function audit_event_unchanged() returns trigger language plpgsql as $$
begin
  raise exception 'An audit event is never changed' using errcode = 'insufficient_privilege';
end
$$;
create trigger audit_event_unchanged before update on audit_event
  for each statement execute function audit_event_unchanged();

-- A label changes only by erasure: its text to the fixed word, with the instant it was erased.
create function audit_label_erased_only() returns trigger language plpgsql as $$
begin
  if new.sequence <> old.sequence or new.role <> old.role
    or new.refers_to is distinct from old.refers_to
    or new.text <> 'erased' or new.erased_at is null then
    raise exception 'An audit label changes only by erasure' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
create trigger audit_label_erased_only before update on audit_label
  for each row execute function audit_label_erased_only();

-- Erasure of a person's labels (VER-038; AU1-C): every label referring to them takes the fixed word,
-- and the erasure is itself an event, attributed by the transaction's audit context like any other.
-- The runtime role may not update a label, so this runs as the schema's owner, on this schema alone.
create function erase_labels(erased uuid) returns integer
  language plpgsql security definer set search_path from current as $$
declare
  context jsonb := nullif(current_setting('alloy.audit', true), '')::jsonb;
  erasing integer;
begin
  if context is null then
    raise exception 'An erasure was asked for with no audit context';
  end if;
  update audit_label set text = 'erased', erased_at = now()
    where refers_to = erased and erased_at is null;
  get diagnostics erasing = row_count;
  insert into audit_event
    (kind, actor_kind, actor, token, subject_kind, subject, outcome, detail, trace_id)
  values (
    'audit.label_erased',
    context ->> 'actorKind',
    (context ->> 'actor')::uuid,
    (context ->> 'token')::uuid,
    'principal',
    erased,
    'done',
    jsonb_build_object('labels', erasing)
      || case when context ? 'requestedBy'
           then jsonb_build_object('requestedBy', context -> 'requestedBy') else '{}' end,
    context ->> 'traceId'
  );
  return erasing;
end
$$;
do $$
begin
  execute 'revoke execute on function erase_labels(uuid) from public';
  execute format('grant execute on function erase_labels(uuid) to %I', current_schema());
end
$$;
