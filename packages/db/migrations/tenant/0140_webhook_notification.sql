-- A webhook disabled for failing (the WB plan, WB-E): the administrator who made it is told, from
-- nobody, on nothing; its counts name the subscription, never its URL or description.
alter table notification
  drop constraint notification_kind,
  drop constraint notification_digest;
alter table notification
  add constraint notification_kind
    check (kind in ('mention', 'reply', 'resolution', 'round', 'digest', 'budget', 'webhook')),
  add constraint notification_digest check (
    (kind in ('digest', 'budget', 'webhook')) = (counts is not null)
    and (
      (kind = 'digest' and round_id is null and thread_id is null)
      or (kind in ('budget', 'webhook') and actor is null and round_id is null and thread_id is null
          and artifact_id is null)
      or (kind = 'round' and actor is not null and round_id is not null and thread_id is null
          and artifact_id is not null)
      or (kind not in ('round', 'digest', 'budget', 'webhook') and actor is not null
          and thread_id is not null and round_id is null and artifact_id is not null)
    )
  );
