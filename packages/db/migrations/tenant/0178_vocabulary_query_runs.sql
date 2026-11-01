-- A vocabulary refreshed from a query (vocabularies.md; the VO plan, VO-J): its run is recorded as any
-- run is (DAT-053), as its own act.

alter table query_run drop constraint query_run_act;
alter table query_run add constraint query_run_act
  check (act in ('sample', 'resolve', 'check', 'creation', 'vocabulary'));
