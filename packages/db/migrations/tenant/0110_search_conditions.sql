set constraints all immediate;

-- Conditions and relationships' fields in search (SCH-061, SCH-063; the R14 plan, R14-D, R14-E): an
-- entry's `field_values` hold its every `axis:value` under `~conditions`, and the field values of the
-- relationships its artifact is an end of under `~relations`, keys no field's id can take. Nothing
-- gains a column; the run that applies this file writes every entry again (`REINDEXED_BY`), and a
-- condition filter is served by these.
create index search_entry_conditions on search_entry
  using gin ((field_values -> '~conditions'));
create index search_history_conditions on search_history
  using gin ((field_values -> '~conditions'));
