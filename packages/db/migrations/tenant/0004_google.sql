-- Who may come through the Google route (IAM-054). Every Google account can authenticate, so a
-- tenant accepting the route names who may enter: addresses it invited, and Workspace domains.

-- An invitation names an address. The first sign-in whose ID token carries it as verified binds the
-- invitation to that account; from then on the principal is found by issuer and subject alone.
create table invitation (
  email text primary key check (email = lower(email) and email like '_%@_%'),
  principal_id uuid references principal on delete cascade,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  check ((principal_id is null) = (accepted_at is null))
);

-- Matched against the ID token's hosted-domain claim, which Google sets only for Workspace accounts
-- the domain manages - never against an address's suffix, which a personal account can share.
create table google_domain (
  domain text primary key check (domain = lower(domain) and domain <> '')
);

-- A Google sign-in admitted at the sign-in address, waiting for its browser to bring the code here.
-- Only the code's hash is kept; attempt_hash ties it to the browser that started the sign-in.
create table sign_in_handoff (
  code_hash text primary key,
  principal_id uuid not null references principal on delete cascade,
  attempt_hash text not null,
  expires_at timestamptz not null
);
