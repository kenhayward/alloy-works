-- An endpoint's kind, timeout and what its model supports (the domain's `modelEndpointSchema`): an LLM
-- answers and an embedding model embeds; a call to it waits its own timeout, or the default where it
-- names none (null); tools are sent only to a model that calls them, and images only to one reading them.

alter table model_endpoint
  add column kind text not null default 'llm' check (kind in ('llm', 'embedding')),
  add column timeout_seconds integer check (timeout_seconds between 1 and 240),
  add column supports_tools boolean not null default true,
  add column supports_images boolean not null default false;

-- An endpoint made before this that embedding goes to, or that serves or waits to serve meaning, is an
-- embedding model; every other an LLM.
update model_endpoint set kind = 'embedding'
  where id in (select endpoint_id from model_route where purpose = 'embedding')
     or id in (select pending_endpoint from embedding_state where pending_endpoint is not null)
     or id in (select serving_endpoint from embedding_state where serving_endpoint is not null);
