-- The embedding job (the G7 plan, G7-F): an artifact waiting to be embedded, once however often it is
-- saved meanwhile, since a tenant's role cannot read the queue; and the endpoint the serving model
-- embeds by, for new content and queries.

create table embedding_queued (
  artifact_id uuid primary key,
  queued_at timestamptz not null default now()
);

alter table embedding_state
  add column serving_endpoint uuid references model_endpoint on delete set null;
