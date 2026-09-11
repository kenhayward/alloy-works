-- How this environment's people sign in, and the sessions they hold. A client secret is never
-- stored here: the row names a secret the service reads from its own store.
create table identity_provider (
  singleton boolean primary key default true check (singleton),
  issuer text not null,
  client_id text not null,
  secret_name text not null check (secret_name ~ '^[a-z0-9_]{1,64}$')
);

-- The routes this environment permits (IAM-043). No row, no route.
create table sign_in_route (
  route text primary key check (route in ('organisation', 'google'))
);

-- A sign-in between leaving for the provider and coming back. Single use, and short-lived.
create table sign_in_attempt (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique,
  nonce text not null,
  code_verifier text not null,
  route text not null check (route in ('organisation', 'google')),
  expires_at timestamptz not null
);

-- A session holds a hash of its token, never the token, so a copy of the database signs nobody in.
create table session (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  principal_id uuid not null references principal on delete cascade,
  route text not null check (route in ('organisation', 'google')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  idle_expires_at timestamptz not null,
  expires_at timestamptz not null
);
create index session_principal on session (principal_id);
