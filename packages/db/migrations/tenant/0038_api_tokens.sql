-- Personal API tokens (docs/design/service-foundations.md, "Personal tokens, as W12 builds them";
-- ADR-0028). A token belongs to a person, acts as them, and can do no more than they may: its scopes are
-- a mask over their grants at every decision, never a grant of its own (TK-A, IAM-062). Like a session,
-- it is kept as a SHA-256 hash of its secret, never the secret, so a copy of the database authenticates
-- nobody (TK-F).

-- Each scope once, with no null among them: a check may not hold a subquery, so this asks a function
-- that reads no table and so needs no schema.
create function api_token_scopes_distinct(scopes text[]) returns boolean
language sql immutable
set search_path = pg_catalog
as $$
  select count(scope) = count(*) and count(distinct scope) = count(*) from unnest(scopes) as scope
$$;

create table api_token (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references principal on delete cascade,
  name text not null,
  token_hash text not null unique,
  -- A subset of the closed permission set, as role_permissions_closed is (0009), but never `read`:
  -- reading is never masked, so a token reads what its creator reads and a token with no scopes reads
  -- and does nothing else (TK-B). A read scope would be a mask that masks nothing.
  scopes text[] not null,
  created_at timestamptz not null default now(),
  -- Required, and at most a year after the token was made (IAM-034, TK-C). Nothing extends one: a new
  -- token is issued, which is why the runtime role may not change this.
  expires_at timestamptz not null,
  -- Written at most once a minute, by the request that uses it.
  last_used_at timestamptz,
  constraint api_token_name check (name = btrim(name) and char_length(name) between 1 and 80),
  constraint api_token_token_hash check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint api_token_scopes_closed check (
    scopes <@ array[
      'create', 'edit', 'comment', 'suggest', 'approve', 'publish', 'design',
      'manage_definitions', 'administer'
    ]::text[]
    and (array_ndims(scopes) = 1 or scopes = '{}')
    and api_token_scopes_distinct(scopes)
  ),
  constraint api_token_expires_after_creation check (expires_at > created_at),
  constraint api_token_expires_within_a_year check (expires_at <= created_at + interval '365 days')
);
create index api_token_principal on api_token (principal_id);

-- The runtime role issues a token, reads it on every request, records its use and revokes it by
-- deleting its row (IAM-035). It never changes what a token is - its principal, name, hash, scopes or
-- expiry - and never backdates one: created_at is the database's clock, which the expiry is bounded by.
do $$
begin
  execute format('revoke insert, update, truncate on api_token from %I', current_schema());
  execute format(
    'grant insert (principal_id, name, token_hash, scopes, expires_at) on api_token to %I',
    current_schema()
  );
  execute format('grant update (last_used_at) on api_token to %I', current_schema());
end
$$;
