-- A capability's requests and work, measured (diagnostics.md; the DG plan, DG-B, pre-flight 3 to 5): counts
-- and fixed latency buckets by minute, rolled into hours after 7 days and days after 90, forgotten after
-- 13 months. Aggregates alone, never a request, a person or a path, so nothing here is content. Left
-- out of every export: a copy of an environment starts measuring afresh.
create table capability_usage (
  span text not null check (span in ('minute', 'hour', 'day')),
  at timestamptz not null,
  -- The contract's tag, or a kind of the worker's work (DG-C).
  capability text not null check (capability ~ '^[A-Za-z][A-Za-z0-9 _-]{0,63}$'),
  -- Which bounds `buckets` was counted against (packages/domain, `BUCKETS_VERSION`).
  buckets_version smallint not null check (buckets_version > 0),
  requests integer not null check (requests >= 0),
  client_errors integer not null default 0 check (client_errors >= 0),
  server_errors integer not null default 0 check (server_errors >= 0),
  -- Refused by the environment's state (TL-B): counted, and kept out of its health.
  refused integer not null default 0 check (refused >= 0),
  buckets integer[] not null check (array_ndims(buckets) = 1 and 0 <= all (buckets)),
  primary key (span, at, capability, buckets_version)
);
