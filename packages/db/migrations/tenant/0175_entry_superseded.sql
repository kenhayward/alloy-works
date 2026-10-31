-- An entry superseded (LIB-035; docs/design/reference-sources.md): its source reports a newer version
-- or edition, or a record that replaces it. A check outcome, flagged and told of as a correction is.
alter table bibliography_entry_status
  drop constraint bibliography_entry_status_outcome_check,
  add constraint bibliography_entry_status_outcome_check
    check (outcome in ('current', 'changed', 'gone', 'retracted', 'superseded', 'corrected'));

alter table bibliography_entry_told
  drop constraint bibliography_entry_told_outcome_check,
  add constraint bibliography_entry_told_outcome_check
    check (outcome in ('retracted', 'superseded', 'corrected'));
