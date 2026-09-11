-- What an environment is called where its own people see it: the sign-in page, the header.
-- Exactly one row; the primary key cannot be anything but true.
create table profile (
  singleton boolean primary key default true check (singleton),
  display_name text not null,
  updated_at timestamptz not null default now()
);
