-- Usage counted by day (diagnostics.md; ADR-0100; the DG plan, DG-I): a UTC day, a measure and a whole
-- amount, counted by the worker each night from each record's own table, kept 396 days. A count is what
-- happened that day; a sample, what was held when it was counted.
create table usage_day (
  day date not null,
  measure text not null check (measure ~ '^[a-z][A-Za-z0-9]{0,63}$'),
  amount bigint not null check (amount >= 0),
  primary key (day, measure)
);
