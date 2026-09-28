-- Groups made, filled and deleted, and the provider's claim read at sign-in (access.md, "Groups and
-- Access, as W12 builds them"; GP-A to GP-D).

-- The claim of the organisation's provider that carries group values, read from the ID token alone
-- under the basic scopes (GP-A, IAM-044). A claim name looks like one: a letter first, then letters,
-- digits and the few marks a namespaced claim uses - `cognito:groups`, or Auth0's
-- `https://example.com/groups` - and 64 characters at most. Nothing here says what a value means: an
-- administrator makes a group for each value that means something (GP-C).
alter table identity_provider
  add column groups_claim text not null default 'groups'
    constraint identity_provider_groups_claim
      check (groups_claim ~ '^[A-Za-z][A-Za-z0-9_.:/-]{0,63}$');

-- A group's grants go with it. 0009 restricted the delete, so a group with grants could not be removed
-- at all; the lock-out guard counts direct grants only (access.md, "Roles"), so no group's grant is ever
-- what keeps a tenant administered, and nothing is lost by the cascade that the guard protects. The
-- cascade deletes each grant as a row, so 0010's `access_grant_changed` takes the epoch for each one,
-- as `group_member_changed` does for each membership 0009's cascade already removes.
alter table access_grant
  drop constraint access_grant_group_id_fkey,
  add constraint access_grant_group_id_fkey
    foreign key (group_id) references access_group on delete cascade;

-- Every decision now reads the tenant's cap on external access (IAM-049): an allow reaching an external
-- principal past it confers nothing, however it arrived - a provider asserting them into a group,
-- which nothing refuses at sign-in, among the ways. So the cap is a fact a decision reads, and a change
-- to it takes the epoch as 0010's triggers do for the rest.
create trigger access_policy_cap_changed after update of external_cap_days on access_policy
  for each row execute function access_changed();

-- A provider value is something a claim can carry: never empty.
alter table access_group
  add constraint access_group_provider_value_filled check (provider_value <> '');

-- Removing a member and deleting a group are the runtime role's, as an administrator's acts through the
-- service. The schema's default privileges already grant both; they are stated here, where somebody
-- reading what groups may do will look.
do $$
begin
  execute format('grant delete on group_member, access_group to %I', current_schema());
end
$$;
