-- A principal is a person or a service, found by the identity provider's issuer and subject and
-- never by email address, which can be reassigned. The same human in two tenants is two principals.
create table principal (
  id uuid primary key default gen_random_uuid(),
  issuer text not null,
  subject text not null,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  unique (issuer, subject)
);
