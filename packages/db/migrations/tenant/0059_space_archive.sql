-- Archiving a space (the SP1 plan, SP-C): when and by whom, both null while it is live and both set
-- once archived. Nothing new is made in an archived space; what is already there is unchanged.
-- Restoring clears both, so `archived_by` names who archived it last, until the audit log records
-- each act (SP-H). No decision reads either column, so neither takes the access epoch.
alter table space
  add column archived_at timestamptz,
  add column archived_by uuid references principal on delete restrict,
  add constraint space_archived_both check ((archived_at is null) = (archived_by is null));
