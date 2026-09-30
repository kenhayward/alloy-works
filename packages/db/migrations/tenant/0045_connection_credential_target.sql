-- A connection's credential is bound to the target it was set for (the D1 fix, C3): the SHA-256, in
-- hex, of `connectionTarget` - the connection's type, host, port, database, account and TLS - at the
-- version it was set against. The service hands the connector a credential only while the latest
-- version's target has the same digest, and the connector opens it only with that target as the
-- seal's associated data, so a version that points the connection anywhere else leaves no usable
-- credential until one is set again. A row set before this column is bound to nothing, and is never
-- usable: its password must be set again.
alter table connection_credential add column target_digest text
  constraint connection_credential_target_digest check (target_digest ~ '^[0-9a-f]{64}$');

do $$
begin
  execute format(
    'grant insert (target_digest) on connection_credential to %I',
    current_schema()
  );
end
$$;
