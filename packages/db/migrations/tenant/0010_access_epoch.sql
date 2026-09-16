-- IAM-063: a decision and the act it authorises are one unit (access.md, "Taking the decision with the
-- act"). Every decision reads this one row FOR SHARE inside the transaction of its act; every change to
-- anything a decision reads updates it, which takes the row's exclusive lock. So a revocation that
-- starts while a write is authorised waits for that write to commit, and a write that starts after a
-- revocation waits for it and then sees it.
create table access_epoch (
  singleton boolean primary key default true check (singleton),
  changed_at timestamptz not null default now()
);
insert into access_epoch default values;

-- The row must always be there: a decision that locked no row would lock nothing. The runtime role keeps
-- UPDATE, which both the lock and the triggers below need.
do $$
begin
  execute format('revoke insert, delete, truncate on access_epoch from %I', current_schema());
end
$$;

-- A trigger rather than a call in each write path, because the rule is "every write to a fact", and a
-- write path that forgot the call would be silent. Qualified by the table's own schema, so it holds
-- whatever the search path of the session making the change.
create function access_changed() returns trigger
language plpgsql as $$
begin
  execute format('update %I.access_epoch set changed_at = now()', tg_table_schema);
  return null;
end
$$;

-- Row triggers, so a statement that changes nothing - removing an empty group, whose cascade deletes no
-- member - takes no lock. Inserting a role, a group, a space or an artifact changes no decision anybody
-- could already ask, and a role can be removed only while no grant names it, so none of those takes it.
create trigger access_grant_changed after insert or delete on access_grant
  for each row execute function access_changed();
create trigger role_permissions_changed after update of permissions on role
  for each row execute function access_changed();
create trigger group_member_changed after insert or update or delete on group_member
  for each row execute function access_changed();
create trigger principal_kind_changed after update of kind on principal
  for each row execute function access_changed();
create trigger artifact_space_changed after update of space_id on artifact
  for each row execute function access_changed();
