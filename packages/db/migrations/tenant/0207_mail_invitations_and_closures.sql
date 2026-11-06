-- Invitations and closure notices by email (mail.md; the EM plan, EM-S, EM-U and EM-V): a mail queued
-- for each invitation sent or renewed, and one to each person who signs in in the ordinary way on a
-- closing starting, 7 days before its grace ends, and on its being cancelled.

alter table email_delivery
  drop constraint email_delivery_purpose_check,
  add constraint email_delivery_purpose_check
    check (purpose in ('test', 'notification', 'invitation', 'closure')),
  -- An invitation's mail names it, so withdrawing it leaves nothing to send (EM-F).
  add column invitation_id uuid references invitation (id) on delete cascade,
  add constraint email_delivery_invitation check (
    (purpose = 'invitation') = (invitation_id is not null)),
  -- Which notice of a closing, and when its grace ends, as it was when queued (EM-V).
  add column notice text check (notice in ('closing', 'seven_days', 'cancelled')),
  add column grace_ends_at timestamptz,
  add constraint email_delivery_notice check (
    (purpose = 'closure') = (notice is not null)
    and ((notice in ('closing', 'seven_days')) = (grace_ends_at is not null)));
create index email_delivery_invitation on email_delivery (invitation_id, created_at)
  where invitation_id is not null;
-- Each notice of one closing once to a person, however often its sweep runs (EM-V).
create unique index email_delivery_notice_once on email_delivery (notice, grace_ends_at, principal_id)
  where notice in ('closing', 'seven_days');

-- Queued from the audit log, with the inserter's rights, so every path that invites or renews passes
-- here and nothing else does: `invite` and the first administrator's naming record it, a share's
-- extension and a narrowing of how it may be claimed do not (EM-U). Both restores disable user
-- triggers, so an import mails nobody. One a day to an address, since every repeat renews, and 100 a
-- day a tenant (EM-S): beyond either, queued dropped, so Administration counts it.
create function email_queue_audit() returns trigger
language plpgsql
as $$
declare
  invited uuid;
  waiting uuid;
  reason text;
begin
  if new.outcome <> 'done' then
    return null;
  end if;
  if new.kind in ('invitation.sent', 'tenant.administrator_named') then
    select i.id, i.principal_id into invited, waiting from invitation i
     where i.accepted_at is null
       and (case when new.kind = 'invitation.sent' then i.id = new.subject
                 else i.principal_id = new.subject end);
    if invited is null then
      return null;
    end if;
    if exists (select from email_delivery
                where invitation_id = invited and state <> 'dropped'
                  and created_at > now() - interval '1 day') then
      reason := 'invitation_repeated';
    elsif (select count(*) from email_delivery
            where purpose = 'invitation' and state <> 'dropped'
              and created_at > now() - interval '1 day') >= 100 then
      reason := 'invitation_quota';
    end if;
    insert into email_delivery (purpose, principal_id, invitation_id, state, dropped_reason)
    values ('invitation', waiting, invited,
            case when reason is null then 'pending' else 'dropped' end, reason);
  elsif new.kind in ('tenant.closing', 'tenant.closure_cancelled') then
    -- A closing given up is no longer closing: what still waits to say it is is never sent.
    if new.kind = 'tenant.closure_cancelled' then
      update email_delivery set state = 'dropped', dropped_reason = 'closure_cancelled', locked_until = null
       where state = 'pending' and notice in ('closing', 'seven_days');
    end if;
    -- Everybody who signs in in the ordinary way; whom it may reach is decided again at sending,
    -- so the unverified are counted among what was dropped (EM-V).
    insert into email_delivery (purpose, principal_id, notice, grace_ends_at)
    select 'closure', p.id,
           case when new.kind = 'tenant.closing' then 'closing' else 'cancelled' end,
           case when new.kind = 'tenant.closing' then (new.detail ->> 'graceEndsAt')::timestamptz end
      from principal p
     where p.kind in ('user', 'external') and p.issuer is not null
       and p.disabled_at is null and p.erased_at is null
    on conflict do nothing;
  end if;
  return null;
end
$$;
create trigger email_queue_audit after insert on audit_event
  for each row execute function email_queue_audit();
