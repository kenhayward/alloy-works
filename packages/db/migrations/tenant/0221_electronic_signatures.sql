-- Electronic signatures (LIF-083, LIF-087; the ES plan, ES-G and ES-Q; ADR-0104): each the signature a
-- signed document gate's approval or rejection is, on the baseline that is the electronic record.
-- Inserted and never changed: the service may insert and select, nothing more. The parts are kept as
-- signed, and `digest` is SHA-256 over their manifest (domain's `signatureManifest`), `mac` a keyed MAC
-- over the digest whose key never leaves the service.

create table electronic_signature (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  document_kind text not null default 'document' check (document_kind = 'document'),
  baseline_id uuid not null,
  baseline_digest text not null
    constraint electronic_signature_baseline_digest check (baseline_digest ~ '^[0-9a-f]{64}$'),
  version_id uuid not null,
  -- The approval or rejection it is, once; its round, definition and transition, as that one's.
  approval_id bigint not null unique references workflow_approval on delete restrict,
  round bigint not null references workflow_transition on delete restrict,
  definition_id uuid not null,
  transition text not null check (transition ~ '^[a-z][a-z0-9_]*$'),
  -- The signer (ES-O): the principal, and as the provider named them when they signed.
  principal_id uuid not null references principal on delete restrict,
  issuer text not null check (char_length(issuer) between 1 and 2000),
  subject text not null check (char_length(subject) between 1 and 2000),
  provider_key text check (char_length(provider_key) between 1 and 2000),
  signer_name text not null check (char_length(signer_name) between 1 and 500),
  signer_address text not null check (char_length(signer_address) between 1 and 500),
  role_name text not null check (char_length(role_name) between 1 and 200),
  title text not null check (char_length(title) between 1 and 2000),
  baseline_name text not null check (char_length(baseline_name) between 1 and 120),
  decision text not null check (decision in ('approved', 'rejected')),
  meaning text not null check (char_length(meaning) between 1 and 500),
  reason text check (char_length(reason) between 1 and 2000),
  signed_at timestamptz not null,
  -- The signer's offset from UTC when they signed, in minutes (LIF-062).
  offset_minutes integer not null check (offset_minutes between -840 and 840),
  -- The signing attempt that applied it, once (ES-H). An attempt is short-lived and not kept, so no
  -- foreign key: this only refuses one attempt applying twice.
  signing_attempt uuid unique,
  digest text not null constraint electronic_signature_digest check (digest ~ '^[0-9a-f]{64}$'),
  mac text not null constraint electronic_signature_mac check (mac ~ '^[0-9a-f]{64}$'),
  written_by xid8 not null default pg_current_xact_id(),
  constraint electronic_signature_reason check ((decision = 'rejected') = (reason is not null)),
  foreign key (document_id, document_kind) references artifact (id, kind) on delete restrict,
  foreign key (baseline_id, document_id) references baseline (id, document_id) on delete restrict,
  foreign key (version_id, document_id, document_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict,
  foreign key (definition_id, document_kind)
    references workflow_definition (id, kind) on delete restrict
);
create index electronic_signature_document on electronic_signature (document_id, signed_at desc);
create index electronic_signature_baseline on electronic_signature (baseline_id);

-- A digest not its baseline's, a baseline of another version than the one signed (a new version starts
-- the round again on a new baseline), or an approval that is another's, is refused, however it is
-- written: an import restores rows whose approvals it renumbered, and those still name their own.
create function electronic_signature_bound() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from baseline b
                  where b.id = new.baseline_id and b.digest = new.baseline_digest) then
    raise exception 'electronic_signature: the baseline digest is not its baseline''s';
  end if;
  if not exists (select 1 from baseline b
                  where b.id = new.baseline_id and b.document_version_id = new.version_id) then
    raise exception 'electronic_signature: the baseline is not of the version signed';
  end if;
  if not exists (select 1 from workflow_approval a
                  where a.id = new.approval_id
                    and a.artifact_id = new.document_id and a.kind = 'document'
                    and a.version_id = new.version_id and a.round = new.round
                    and a.definition_id = new.definition_id and a.transition = new.transition
                    and a.decision = new.decision and a.by = new.principal_id
                    and a.reason is not distinct from new.reason) then
    raise exception 'electronic_signature: the approval is not this signature''s';
  end if;
  return new;
end
$$;
create trigger electronic_signature_bound before insert on electronic_signature
  for each row execute function electronic_signature_bound();

do $$
begin
  execute format(
    'revoke insert, update, delete, truncate on electronic_signature from %I', current_schema()
  );
  execute format(
    'grant insert (document_id, baseline_id, baseline_digest, version_id, approval_id, round, definition_id, transition, principal_id, issuer, subject, provider_key, signer_name, signer_address, role_name, title, baseline_name, decision, meaning, reason, signed_at, offset_minutes, signing_attempt, digest, mac) on electronic_signature to %I',
    current_schema()
  );
  execute format('grant select on electronic_signature to %I', current_schema());
end
$$;
