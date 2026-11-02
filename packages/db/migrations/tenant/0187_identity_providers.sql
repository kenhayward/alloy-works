-- More than one identity provider (the ID plan, IDa; IAM-011; docs/design/identity.md, "Providers").
-- The singleton row becomes the first of any number, keyed by id and named for the sign-in page. Two
-- clients of one issuer would sign the same people in twice over, so an issuer is configured once.
alter table identity_provider drop constraint identity_provider_pkey;
alter table identity_provider drop column singleton;
alter table identity_provider add column id uuid not null default gen_random_uuid() primary key;
alter table identity_provider add column name text;
update identity_provider set name = 'Your organisation';
alter table identity_provider
  alter column name set not null,
  add constraint identity_provider_name check (name = btrim(name) and name <> '' and length(name) <= 80),
  add constraint identity_provider_name_unique unique (name),
  add constraint identity_provider_issuer_unique unique (issuer),
  -- A closed provider signs nobody in; it is kept, so what it issued still names it.
  add column closed_at timestamptz;

-- Which provider an attempt went to and a session came through: the organisation's route only.
alter table sign_in_attempt add column provider_id uuid references identity_provider on delete cascade;
alter table session add column provider_id uuid references identity_provider on delete cascade;
update sign_in_attempt set provider_id = (select id from identity_provider) where route = 'organisation';
update session set provider_id = (select id from identity_provider) where route = 'organisation';

-- A provider's groups are its own (IN-I): its claim settles only them, and a value is unique within a
-- provider, not across all. A provider group made before any provider was configured names none, and
-- no claim reaches it until an administrator gives it one.
alter table access_group add column provider_id uuid references identity_provider;
update access_group set provider_id = (select id from identity_provider) where source = 'provider';
alter table access_group
  drop constraint access_group_provider_value_key,
  add constraint access_group_provider_only check (provider_id is null or source = 'provider');
-- Unique within a provider, and among those naming none.
create unique index access_group_provider_value_unique on access_group
  (coalesce(provider_id, '00000000-0000-0000-0000-000000000000'::uuid), provider_value)
  where provider_value is not null;

-- The ways an invitation may be claimed through (IN-J): Google, and each provider named. One made
-- before this kept every way open, and keeps every way open now.
alter table invitation add column through_google boolean not null default true;
create table invitation_provider (
  invitation_id uuid not null references invitation on delete cascade,
  provider_id uuid not null references identity_provider on delete cascade,
  primary key (invitation_id, provider_id)
);
insert into invitation_provider (invitation_id, provider_id)
  select i.id, p.id from invitation i cross join identity_provider p where i.accepted_at is null;

-- An invitation made from now on may be claimed through the providers open as it is made, and no
-- other: a provider added later cannot claim it by asserting its address (IN-J). Every way an
-- invitation is made - an administrator's, the vendor's first administrator, an operator's - is covered,
-- and the vendor's and an operator's connections have no search_path to rely on, so each name is the
-- trigger's own schema.
create function invitation_through_open_providers() returns trigger
  language plpgsql as $$
begin
  execute format(
    'insert into %1$I.invitation_provider (invitation_id, provider_id)
     select $1, p.id from %1$I.identity_provider p where p.closed_at is null',
    tg_table_schema
  ) using new.id;
  return new;
end
$$;
create trigger invitation_through_open_providers after insert on invitation
  for each row execute function invitation_through_open_providers();

-- An environment's first provider takes the invitations made before it, which had no provider to
-- name: the vendor invites a first administrator before the customer's provider is configured.
create function first_provider_takes_invitations() returns trigger
  language plpgsql as $$
declare
  providers bigint;
begin
  execute format('select count(*) from %I.identity_provider', tg_table_schema) into providers;
  if providers = 1 then
    execute format(
      'insert into %1$I.invitation_provider (invitation_id, provider_id)
       select i.id, $1 from %1$I.invitation i where i.accepted_at is null',
      tg_table_schema
    ) using new.id;
  end if;
  return new;
end
$$;
create trigger first_provider_takes_invitations after insert on identity_provider
  for each row execute function first_provider_takes_invitations();

do $$
begin
  execute format('grant insert (through_google) on invitation to %I', current_schema());
end
$$;
