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
