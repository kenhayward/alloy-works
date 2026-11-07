-- Silent failures told (diagnostics.md, "Who else is told"; the DG plan, DGe4; ADM-037): each failure
-- administrators were told of, by its kind and subject, until it clears and is forgotten, so its return
-- tells again. Left out of exports.
create table silent_failure_told (
  failure text primary key check (failure ~ '^[a-z_]+:.{0,200}$'),
  told_at timestamptz not null default now()
);

-- Told to those who administer, by an inbox kind never mailed, naming the failure in `counts`.
alter table notification
  drop constraint notification_kind,
  drop constraint notification_digest;
alter table notification
  add constraint notification_kind
    check (kind in ('mention', 'reply', 'resolution', 'round', 'digest', 'budget', 'webhook', 'reference',
                    'import', 'mail', 'diagnostics')),
  add constraint notification_digest check (
    (kind in ('digest', 'budget', 'webhook', 'reference', 'import', 'diagnostics')) = (counts is not null)
    and (
      (kind = 'digest' and round_id is null and thread_id is null)
      or (kind in ('budget', 'webhook', 'import', 'mail', 'diagnostics') and actor is null
          and round_id is null and thread_id is null and artifact_id is null)
      or (kind = 'reference' and actor is null and round_id is null and thread_id is null
          and artifact_id is not null)
      or (kind = 'round' and actor is not null and round_id is not null and thread_id is null
          and artifact_id is not null)
      or (kind not in ('round', 'digest', 'budget', 'webhook', 'reference', 'import', 'mail',
                       'diagnostics')
          and actor is not null and thread_id is not null and round_id is null
          and artifact_id is not null)
    )
  );
