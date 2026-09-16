-- How a tenant gets its first administrator (access.md, "Roles"). Whoever provisions the tenant names
-- an identity by the provider's issuer and subject - never an address or a claim a user could set on
-- themselves - and the first sign-in as that identity is granted Administrator at the tenant, once,
-- under the access lock, and only while nobody administers the tenant. The row is kept as the record.
create table first_administrator (
  id uuid primary key default gen_random_uuid(),
  issuer text not null check (issuer <> ''),
  subject text not null check (subject <> ''),
  role_id uuid not null references role on delete restrict,
  named_by text not null check (named_by <> ''),
  named_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by uuid references principal on delete restrict,
  outcome text check (outcome in ('granted', 'refused_administrator_exists')),
  constraint first_administrator_claim check (
    (claimed_at is null) = (outcome is null) and (claimed_at is null) = (claimed_by is null)
  )
);

-- At most one naming waits to be claimed.
create unique index first_administrator_open on first_administrator ((true)) where claimed_at is null;

-- The runtime role reads a naming and records its claim, and nothing else: only whoever provisions
-- the tenant, as an administrator of the database, can name somebody.
do $$
begin
  execute format(
    'revoke insert, update, delete, truncate on first_administrator from %I',
    current_schema()
  );
  execute format(
    'grant update (claimed_at, claimed_by, outcome) on first_administrator to %I',
    current_schema()
  );
end
$$;

-- A used naming's claim can never be cleared, rewritten or made again: the only update this table
-- ever takes is the one move from unclaimed to claimed, with who and what was named untouched. The
-- runtime role's own UPDATE grant above would otherwise be enough, on its own, to reopen a used
-- naming (clearing claimed_at, claimed_by and outcome) or to hand an existing claim to a different
-- principal - so this holds regardless of which columns a role may write, not only what the grant
-- above allows.
create function first_administrator_claim_once() returns trigger
language plpgsql as $$
begin
  if not (
    old.claimed_at is null
    and new.claimed_at is not null
    and old.issuer is not distinct from new.issuer
    and old.subject is not distinct from new.subject
    and old.role_id is not distinct from new.role_id
    and old.named_by is not distinct from new.named_by
  ) then
    raise exception
      'first_administrator: a naming may only move once, from unclaimed to claimed, without changing who or what was named';
  end if;
  return new;
end
$$;

create trigger first_administrator_claim_once before update on first_administrator
  for each row execute function first_administrator_claim_once();
