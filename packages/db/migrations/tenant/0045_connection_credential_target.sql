-- A connection's credential is bound to the target it was set for (the D1 fix, C3): the SHA-256, in
-- hex, of `connectionTarget` - the connection's type, host, port, database, account and TLS - at the
-- version it was set against. The service hands the connector a credential only while the latest
-- version's target has the same digest, and the connector opens it only with that target as the
-- seal's associated data, so a version that points the connection anywhere else leaves no usable
-- credential until one is set again. A row set before this column is bound to nothing, and is never
-- usable: its password must be set again.
alter table connection_credential add column target_digest text
  constraint connection_credential_target_digest check (target_digest ~ '^[0-9a-f]{64}$');

-- A test names the credential row it was made with (the D1 fix, round two), as it names the version
-- it tested: a test of an earlier credential - one that answered after a newer credential was set and
-- tested - is then read as no test of the one set now. The credential is the same connection's. A test
-- recorded before this column names none, and is read as of no credential set now.
alter table connection_credential
  add constraint connection_credential_of_connection unique (id, connection_id);
alter table connection_test add column credential_id bigint,
  add constraint connection_test_credential foreign key (credential_id, connection_id)
    references connection_credential (id, connection_id) on delete restrict;

do $$
begin
  execute format(
    'grant insert (target_digest) on connection_credential to %I',
    current_schema()
  );
  execute format(
    'grant insert (credential_id) on connection_test to %I',
    current_schema()
  );
end
$$;
