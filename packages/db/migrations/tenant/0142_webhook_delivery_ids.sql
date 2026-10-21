-- Each delivery its own id (issue #750): 0139 took it from an uncorrelated lateral, which the planner
-- may evaluate once a statement, so two subscriptions wanting one act collided on the key and the act
-- failed. A volatile column of a subquery is evaluated a row.
create or replace function webhook_queue_audit() returns trigger
language plpgsql
as $$
begin
  if new.outcome <> 'done' or new.kind not in ('content.version_cut', 'content.restored', 'artifact.archived', 'artifact.unarchived', 'workflow.transitioned', 'approval.given', 'gate.rejected', 'revision.effective', 'round.opened', 'round.closed', 'review.completed', 'review.reopened', 'review.lapsed', 'publication.requested', 'publication.produced', 'publication.failed') then
    return null;
  end if;
  insert into webhook_delivery (id, subscription_id, type, sequence, artifact_id, payload)
  select d.id, d.subscription, new.kind, 'audit:' || new.sequence, new.subject,
         jsonb_build_object(
           'type', new.kind,
           'id', d.id,
           'sequence', 'audit:' || new.sequence,
           'at', new.at,
           'subject', jsonb_build_object(
             'kind', new.subject_kind, 'id', new.subject, 'version', new.subject_version),
           'detail', new.detail)
  from (select gen_random_uuid() as id, s.id as subscription
          from webhook_subscription s
         where s.disabled_at is null and new.kind = any (s.event_types)) d;
  return null;
end
$$;

create or replace function webhook_queue_notification() returns trigger
language plpgsql
as $$
begin
  insert into webhook_delivery (id, subscription_id, type, sequence, artifact_id, payload)
  select d.id, d.subscription, 'notification.created', 'notification:' || new.sequence, new.artifact_id,
         jsonb_build_object(
           'type', 'notification.created',
           'id', d.id,
           'sequence', 'notification:' || new.sequence,
           'at', new.at,
           'subject', jsonb_build_object(
             'kind', 'notification', 'id', new.id, 'artifact', new.artifact_id),
           'detail', jsonb_build_object(
             'kind', new.kind, 'thread', new.thread_id, 'round', new.round_id))
  from (select gen_random_uuid() as id, s.id as subscription
          from webhook_subscription s
         where s.disabled_at is null and s.service_identity = new.recipient
           and 'notification.created' = any (s.event_types)) d;
  return null;
end
$$;
