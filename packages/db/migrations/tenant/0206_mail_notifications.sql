-- Notifications by email (mail.md; the EM plan, EM-F, EM-H, EM-N and EM-W): a person's choice per kind,
-- the kinds an environment mails, a mail queued for each notification of those kinds, and the notice
-- to those who configure services that the channel is failing, itself never mailed.

-- The kinds of notification mailed, the digest its own (EM-W).
create function mail_kinds() returns text[]
language sql immutable
as $$ select array['mention', 'reply', 'resolution', 'round', 'digest'] $$;

-- The environment's own policy: the kinds it never mails (COL-060). When those who configure services
-- were told it is failing, cleared by a send (EM-N).
alter table mail_channel
  add column kinds_off text[] not null default '{}' check (kinds_off <@ mail_kinds()),
  add column told_at timestamptz;

-- A person's choice: a row a kind they are not mailed, no row meaning mailed (EM-W).
create table notification_email_off (
  principal_id uuid not null references principal (id) on delete cascade,
  kind text not null check (kind = any (mail_kinds())),
  primary key (principal_id, kind)
);

-- A notification's mail names it, so removing it, its recipient or their address leaves nothing (EM-F).
alter table email_delivery
  drop constraint email_delivery_purpose_check,
  add constraint email_delivery_purpose_check check (purpose in ('test', 'notification')),
  add column notification_id uuid references notification (id) on delete cascade,
  add constraint email_delivery_notification check (
    (purpose = 'notification') = (notification_id is not null));
create index email_delivery_notification on email_delivery (notification_id)
  where notification_id is not null;

-- The channel failing, told to those who configure services (EM-N): nobody acts, nothing is on.
alter table notification
  drop constraint notification_kind,
  drop constraint notification_digest;
alter table notification
  add constraint notification_kind
    check (kind in ('mention', 'reply', 'resolution', 'round', 'digest', 'budget', 'webhook', 'reference',
                    'import', 'mail')),
  add constraint notification_digest check (
    (kind in ('digest', 'budget', 'webhook', 'reference', 'import')) = (counts is not null)
    and (
      (kind = 'digest' and round_id is null and thread_id is null)
      or (kind in ('budget', 'webhook', 'import', 'mail') and actor is null and round_id is null
          and thread_id is null and artifact_id is null)
      or (kind = 'reference' and actor is null and round_id is null and thread_id is null
          and artifact_id is not null)
      or (kind = 'round' and actor is not null and round_id is not null and thread_id is null
          and artifact_id is not null)
      or (kind not in ('round', 'digest', 'budget', 'webhook', 'reference', 'import', 'mail')
          and actor is not null and thread_id is not null and round_id is null
          and artifact_id is not null)
    )
  );

-- Queued as the notification is made, with the inserter's rights (EM-F): every path that tells passes
-- here, and both restores disable user triggers, so an import mails nobody. Only while the channel is
-- on, and never to a service identity, or every environment with mail off would queue a row each.
-- Held five minutes, so one read by then is never sent (EM-H); all else is decided again at sending.
create function email_queue_notification() returns trigger
language plpgsql
as $$
begin
  if new.kind = any (mail_kinds())
     and exists (select from mail_channel where enabled)
     and exists (select from principal where id = new.recipient and kind <> 'service') then
    insert into email_delivery (purpose, principal_id, notification_id, next_at)
    values ('notification', new.recipient, new.id, now() + interval '5 minutes');
  end if;
  return null;
end
$$;
create trigger email_queue_notification after insert on notification
  for each row execute function email_queue_notification();
