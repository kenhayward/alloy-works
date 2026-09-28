-- Each environment's sign-in client secret, held by the environment itself (issue #312). Before this,
-- the row named a secret in the service's one process-wide store, and nothing tied a name to an
-- environment: two environments could name one secret, and one could name another's. Now the secret
-- is sealed into this row as the object store credential is (0005), with the service's sealing key,
-- bound to this tenant and to sign-in, so a sealed secret copied into another environment's row, or an
-- object store credential copied into this one, does not open (docs/design/service-foundations.md,
-- "The organisation's own provider").
--
-- A row written before this keeps its name, so what the environment was configured with can still be
-- read, but the service never reads a secret by name again: such an environment signs nobody in through
-- its provider until it is configured again, which seals its secret and clears the name. Moving the
-- named secret into the row automatically would seal whatever the row named - another environment's
-- secret included - and make the very sharing this removes permanent.
alter table identity_provider
  alter column secret_name drop not null,
  add column sealed_secret text
    constraint identity_provider_sealed_secret
      check (sealed_secret ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  -- Sealed, or named from before this: never both, and never neither.
  add constraint identity_provider_one_secret check (num_nonnulls(sealed_secret, secret_name) = 1);
