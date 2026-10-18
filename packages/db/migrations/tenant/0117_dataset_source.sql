-- A stored result queried as a source (DAT-094; the R21 plan, R21-A) runs on no connection: its runs
-- are recorded with none.

set constraints all immediate;

alter table query_run alter column connection_id drop not null;
