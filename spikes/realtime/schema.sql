-- Throwaway. The realtime spike's database: just enough state for presence, locks and
-- notifications to be real rows, plus a table for an ordinary write load to hammer.
--
-- 500 documents of 30 components each, the components spread across 10 spaces, so a viewer who
-- may read eight of the ten spaces must be sent some events about a document and not others
-- (COL-003).
\timing on
drop table if exists component, lock, presence, instance_heartbeat, inbox, busy;

create table component (
  id int primary key,
  doc_id int not null,
  space_id int not null
);
insert into component
select g, 1 + (g - 1) / 30, 1 + (g % 10)
from generate_series(1, 15000) g;
create index on component (doc_id);

-- The truth about locks is a row. Acquiring one is an update in a transaction; the event that tells
-- everyone else is a NOTIFY in the same transaction, so it cannot be sent for a change that did not
-- commit, or missed for one that did.
create table lock (
  component_id int primary key references component,
  holder int,
  acquired_at timestamptz,
  expires_at timestamptz
);
insert into lock select id, null, null, null from component;

-- Presence is ephemeral, so it is unlogged: fast to write, gone after a crash, which is what
-- presence should do anyway (COL-004). Each row names the instance holding the connection, so an
-- instance that dies takes its viewers' presence with it.
create unlogged table presence (
  viewer int primary key,
  doc_id int not null,
  component_id int,
  mode text not null,
  instance text not null,
  updated_at timestamptz not null default now()
);
create index on presence (doc_id);

create unlogged table instance_heartbeat (
  instance text primary key,
  beat_at timestamptz not null
);

-- The inbox is the record of a notification; the event is only a nudge to go and look.
create table inbox (
  id bigserial primary key,
  recipient int not null,
  created_at timestamptz not null default now(),
  body text not null
);
create index on inbox (recipient, id);

-- Ordinary writes, for measuring what NOTIFY costs everything else.
create table busy (
  id bigserial primary key,
  at timestamptz not null default now(),
  payload text not null
);
