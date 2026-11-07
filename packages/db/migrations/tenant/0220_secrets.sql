-- Secrets (docs/design/secrets.md; the SA plan, SAd; ADM-007, ADM-047).

-- A token replaced is still accepted until `ends_at` (SA-I): set once, from null, and never past its
-- expiry, so nothing lengthens a token. Null is a token that ends only when it expires or is revoked.
alter table api_token
  add column ends_at timestamptz,
  add constraint api_token_ends_by_expiry check (ends_at is null or ends_at <= expires_at);

create function api_token_ends_once() returns trigger
language plpgsql as $$
begin
  if old.ends_at is not null and new.ends_at is distinct from old.ends_at then
    raise exception 'api_token: a token''s end is set once';
  end if;
  return new;
end
$$;
create trigger api_token_ends_once before update of ends_at on api_token
  for each row execute function api_token_ends_once();

do $$
begin
  execute format('grant update (ends_at) on api_token to %I', current_schema());
end
$$;

-- When each secret held in a row was last replaced, set by the database as the sealed value changes,
-- so no write path can forget it. Rows from before this take the nearest time already kept.
alter table identity_provider add column secret_set_at timestamptz;
update identity_provider set secret_set_at = now() where sealed_secret is not null;
create function identity_provider_secret_set() returns trigger
language plpgsql as $$
begin
  if new.sealed_secret is not null
    and (tg_op = 'INSERT' or new.sealed_secret is distinct from old.sealed_secret) then
    new.secret_set_at := now();
  end if;
  return new;
end
$$;
create trigger identity_provider_secret_set before insert or update on identity_provider
  for each row execute function identity_provider_secret_set();

alter table mail_channel add column password_set_at timestamptz;
update mail_channel set password_set_at = updated_at where sealed_password is not null;
create function mail_channel_password_set() returns trigger
language plpgsql as $$
begin
  if new.sealed_password is not null
    and (tg_op = 'INSERT' or new.sealed_password is distinct from old.sealed_password) then
    new.password_set_at := now();
  end if;
  return new;
end
$$;
create trigger mail_channel_password_set before insert or update on mail_channel
  for each row execute function mail_channel_password_set();

alter table webhook_subscription add column secret_set_at timestamptz;
update webhook_subscription
   set secret_set_at = coalesce(previous_until - interval '24 hours', created_at)
 where sealed is not null;
create function webhook_subscription_secret_set() returns trigger
language plpgsql as $$
begin
  if new.sealed is not null
    and (tg_op = 'INSERT' or new.sealed is distinct from old.sealed) then
    new.secret_set_at := now();
  end if;
  return new;
end
$$;
create trigger webhook_subscription_secret_set before insert or update on webhook_subscription
  for each row execute function webhook_subscription_secret_set();
