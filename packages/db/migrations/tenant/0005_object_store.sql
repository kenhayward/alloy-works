-- The credential this tenant's objects are reached with. The store issues it, scoped to this
-- tenant's prefix; the secret is sealed before it is written here, so the row alone unlocks nothing.
create table object_store_credential (
  singleton boolean primary key default true check (singleton),
  access_key_id text not null,
  sealed_secret text not null,
  created_at timestamptz not null default now()
);
