-- The provider asked again (the PC plan, PC-A; IAM-010): an organisation's sign-in keeps its refresh
-- token, sealed to the tenant and the session's id, so the session can ask the provider every few
-- minutes whether its person may still sign in. Only a sealed value is ever stored, and only for a
-- session that came through a provider. Neither column is set for a session made before this one.
alter table session
  add column sealed_refresh text,
  add column provider_checked_at timestamptz,
  add constraint session_sealed_refresh_provider check (sealed_refresh is null or provider_id is not null),
  add constraint session_sealed_refresh_sealed check (sealed_refresh like 'v1.%');

do $$
begin
  execute format('grant update (sealed_refresh, provider_checked_at) on session to %I', current_schema());
end
$$;
