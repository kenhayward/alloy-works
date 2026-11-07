-- Support access (docs/design/support.md; the SA plan, SA-D, SA-G): granting it is `grant_support`, the
-- last of IAM-070's acts named apart from `administer`, given here to every role holding `administer`.
-- A person's act alone, so no token's scope: api_token's check already leaves it out.
alter table role drop constraint role_permissions_closed;
alter table role add constraint role_permissions_closed check (
  permissions <@ array[
    'read', 'create', 'edit', 'comment', 'suggest', 'approve', 'publish', 'design',
    'manage_definitions', 'administer', 'use_connection', 'write_sql', 'retire',
    'export_environment', 'export_audit', 'hold',
    'rotate_secrets', 'configure_services', 'configure_webhooks', 'import_environment',
    'close_environment', 'suspend_environment', 'suspend_tenant', 'create_tenant', 'share_provider',
    'read_diagnostics', 'grant_support'
  ]::text[]
  and (array_ndims(permissions) = 1 or permissions = '{}')
);

update role set permissions = permissions || array['grant_support']
  where 'administer' = any(permissions);

-- A support grant, decided apart from access_grant (IAM-071 stands): somebody from outside, invited by
-- address, let read diagnostics, or metadata or content in the spaces named, for a purpose, until a
-- required expiry the tenant's cap on outside access bounds. Kept once ended, always: a revocation, or a
-- cap lowered past it, stamps it; an expiry changes nothing; its principal cannot be removed under it.
create table support_grant (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references principal (id) on delete restrict,
  -- The invitation the grant made for its address, which revoking it withdraws; null where it made none.
  invitation_id uuid references invitation (id),
  scope text not null check (scope in ('diagnostics', 'metadata', 'content')),
  spaces uuid[] not null default '{}'
    check (array_ndims(spaces) = 1 or spaces = '{}'),
  purpose text not null check (length(btrim(purpose)) between 1 and 500),
  expires_at timestamptz not null,
  granted_by uuid not null references principal (id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references principal (id),
  -- revoked: by an administrator, named; cap_lowered: the tenant's cap lowered past its expiry.
  revoked_reason text check (revoked_reason in ('revoked', 'cap_lowered')),
  -- The last UTC day its use was recorded (support.used, once a person a day a scope).
  used_on date,
  check (expires_at > granted_at),
  check (scope = 'diagnostics' or cardinality(spaces) > 0),
  check (
    (revoked_at is null and revoked_reason is null and revoked_by is null)
    or (revoked_at is not null and revoked_reason = 'revoked' and revoked_by is not null)
    or (revoked_at is not null and revoked_reason = 'cap_lowered' and revoked_by is null)
  )
);
create index support_grant_principal on support_grant (principal_id) where revoked_at is null;

-- Written once, then only stamped revoked or used: never edited, never removed by the service.
do $$
begin
  execute format('revoke update, delete, truncate on support_grant from %I', current_schema());
  execute format('grant update (revoked_at, revoked_by, revoked_reason, used_on) on support_grant to %I',
    current_schema());
end
$$;

-- A fact a decision reads, so a grant and a revocation take the access epoch and tell the stream
-- (0010, 0067); recording its use does not.
create trigger support_grant_changed after insert or delete or update of revoked_at
  on support_grant for each row execute function access_changed();

-- A cap lowered past a grant's expiry ends it (IAM-049; support.md): revoked, by nobody named, and
-- audited as support.revoked with its reason, in the transaction that lowered it. Raising the cap again
-- revives nothing.
create function support_cap_lowered() returns trigger
language plpgsql as $$
declare
  context jsonb := nullif(current_setting('alloy.audit', true), '')::jsonb;
begin
  if new.external_cap_days >= old.external_cap_days then
    return null;
  end if;
  execute format($q$
    with ended as (
      update %1$I.support_grant set revoked_at = now(), revoked_reason = 'cap_lowered'
       where revoked_at is null and expires_at > now()
         and expires_at > now() + make_interval(days => $1)
      returning id, principal_id, scope, spaces, purpose, expires_at
    )
    insert into %1$I.audit_event
      (kind, actor_kind, actor, token, subject_kind, subject, outcome, detail, trace_id)
    select 'support.revoked', coalesce($2 ->> 'actorKind', 'system'), ($2 ->> 'actor')::uuid,
           ($2 ->> 'token')::uuid, 'support_grant', e.id, 'done',
           jsonb_build_object('principal', e.principal_id, 'scope', e.scope,
             'spaces', to_jsonb(e.spaces), 'purpose', e.purpose,
             'expiresAt', to_char(e.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
             'reason', 'cap_lowered'),
           $2 ->> 'traceId'
      from ended e
    $q$, tg_table_schema) using new.external_cap_days, context;
  return null;
end
$$;
create trigger support_cap_lowered after update of external_cap_days on access_policy
  for each row execute function support_cap_lowered();
