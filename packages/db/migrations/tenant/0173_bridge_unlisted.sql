-- Per target space, each CT Studio property a delivery carried that the space's property map does not
-- name (docs/design/ct-studio-connect.md, "Properties: mapped, ignored or unlisted"): when it was first
-- and last delivered and how many deliveries carried it, until the map names it.
create table bridge_unlisted_property (
  space_id uuid not null references space on delete cascade,
  name text not null check (name <> ''),
  first_delivered timestamptz not null,
  last_delivered timestamptz not null,
  deliveries integer not null check (deliveries > 0),
  primary key (space_id, name)
);
