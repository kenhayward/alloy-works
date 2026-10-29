-- A bridge request's nonce, seen once (docs/design/ct-studio-sink.md, "Signing"; API-066). The unique
-- key is what keeps two service replicas from both accepting one nonce: the second insert conflicts.
-- Rows older than the signing window are swept by the worker.
create table bridge_nonce (
  nonce text primary key check (nonce <> ''),
  at timestamptz not null default now()
);
create index bridge_nonce_at on bridge_nonce (at);

grant usage on schema platform to aw_tenant;
grant insert on bridge_nonce to aw_tenant;
grant select, delete on bridge_nonce to aw_worker;
