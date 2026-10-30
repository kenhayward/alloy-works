-- The environment's one CT Studio (docs/design/ct-studio-connect.md): the service identity its
-- deliveries act as, the token CT Studio holds, and the address and sink id its hand-off page gave.
-- A single row, made by the first connection.
create table ct_studio (
  singleton boolean primary key default true check (singleton),
  identity_id uuid not null references principal on delete restrict,
  -- A revoked token's row is gone, so CT Studio's token is then none.
  token_id uuid references api_token on delete set null,
  address text check (address is null or address <> ''),
  sink_id text check (sink_id is null or sink_id <> ''),
  updated_at timestamptz not null default now()
);
