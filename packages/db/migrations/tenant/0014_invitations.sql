-- Somebody invited by address before they first sign in (access.md, "Invitations"). An invitation makes
-- its principal at once - with no issuer and no subject, since nobody has signed in as it - so a grant
-- names that principal through the grants route like any other, and every rule `grant` applies is
-- applied where the grant is made. The first sign-in whose provider asserts the address as verified,
-- while the invitation is open and unexpired, gives that principal its issuer and subject; from then on
-- it is found by those alone, and the address is only a label.

alter table principal alter column issuer drop not null;
alter table principal alter column subject drop not null;
-- An identity is whole or absent, and a principal with none is somebody's address.
alter table principal add constraint principal_identity_whole
  check ((issuer is null) = (subject is null));
alter table principal add constraint principal_invited_by_address
  check (issuer is not null or email is not null);
-- Whether the provider asserted the address as verified at the principal's last sign-in. Only such an
-- address stops an invitation to it, so an account showing an address it does not own cannot keep
-- somebody else from being invited. False for everybody signed in before this migration, which stops
-- nothing until they next sign in.
alter table principal add column email_verified boolean not null default false;

-- 0004's invitation was keyed by its address and admitted a Google account. It becomes one row per
-- invitation, each with the principal it made.
alter table invitation drop constraint invitation_pkey;
alter table invitation drop constraint invitation_check;
alter table invitation add column id uuid not null default gen_random_uuid();
alter table invitation add primary key (id);
-- Who invited: a principal, through the service; or, as `named_by`, whoever provisions the tenant.
alter table invitation add column invited_by uuid references principal on delete restrict;
alter table invitation add column named_by text check (named_by <> '');
alter table invitation add constraint invitation_one_inviter
  check (num_nonnulls(invited_by, named_by) <= 1);
-- None means it never lapses, which only an operator's `inviteToTenant` and a row older than this
-- migration can be.
alter table invitation add column expires_at timestamptz;
alter table invitation add column accepted_through text
  check (accepted_through in ('organisation', 'google'));

-- An invitation still waiting gets the principal its sign-in would have made.
do $$
declare
  waiting record;
  made uuid;
begin
  for waiting in select id, email from invitation where principal_id is null loop
    insert into principal (email) values (waiting.email) returning id into made;
    update invitation set principal_id = made where id = waiting.id;
  end loop;
end
$$;

alter table invitation alter column principal_id set not null;
alter table invitation add constraint invitation_principal_once unique (principal_id);
alter table invitation add constraint invitation_accepted_through
  check (accepted_through is null or accepted_at is not null);
-- At most one invitation waits for an address.
create unique index invitation_open on invitation (email) where accepted_at is null;

-- The runtime role never sets who invited on the tenant's behalf: `invited_by` it may write itself -
-- an administrator inviting through the service - but `named_by` records only what an administrator
-- of the database put there while provisioning, and no request through the service may write it.
-- Table-level insert and update are dropped and re-granted only for the columns the service actually
-- writes, the way 0011 restricted `first_administrator`'s own claim columns - naming `named_by` out of
-- both lists, rather than revoking it by name, is what makes the exclusion hold: Postgres ignores
-- `revoke insert (col)` / `revoke update (col)` once a role already holds the unqualified, table-level
-- privilege a column-level grant would otherwise narrow.
do $$
begin
  execute format('revoke insert, update on invitation from %I', current_schema());
  execute format(
    'grant insert (email, principal_id, invited_by, expires_at) on invitation to %I',
    current_schema()
  );
  execute format(
    'grant update (expires_at, accepted_at, accepted_through) on invitation to %I',
    current_schema()
  );
end
$$;
