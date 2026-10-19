-- Meaning (SCH-013, VER-039, VER-040, GEN-044; the G7 plan, G7-B to G7-J): the embedding store, keyed by
-- a block's words' hash, model and model version, written once; a passage, one per block of an entry
-- with a vector for the serving model, joined to its entry for every filter; a searcher's own query
-- vectors, kept a day; and which model serves and which waits to.

create table embedding (
  text_hash text not null check (text_hash ~ '^[0-9a-f]{64}$'),
  model text not null check (char_length(model) between 1 and 200),
  -- As the reply named the model: a provider changing one silently under a name is not seen (G7-B).
  model_version text not null check (char_length(model_version) between 1 and 200),
  dims integer not null check (dims in (384, 768, 1024, 1536, 3072)),
  vector halfvec not null,
  made_at timestamptz not null default now(),
  primary key (text_hash, model, model_version),
  check (vector_dims(vector) = dims)
);

create table search_passage (
  entry_id uuid not null references search_entry on delete cascade,
  block_id text not null check (char_length(block_id) between 1 and 64),
  text_hash text not null,
  model text not null,
  dims integer not null check (dims in (384, 768, 1024, 1536, 3072)),
  vector halfvec not null,
  primary key (entry_id, block_id, model)
);
create index search_passage_hash on search_passage (text_hash, model);

-- An index wants one dimension: one each, partial, used where a query names the dimension (G7-D).
create index search_passage_384 on search_passage
  using hnsw ((vector::halfvec(384)) halfvec_cosine_ops) where dims = 384;
create index search_passage_768 on search_passage
  using hnsw ((vector::halfvec(768)) halfvec_cosine_ops) where dims = 768;
create index search_passage_1024 on search_passage
  using hnsw ((vector::halfvec(1024)) halfvec_cosine_ops) where dims = 1024;
create index search_passage_1536 on search_passage
  using hnsw ((vector::halfvec(1536)) halfvec_cosine_ops) where dims = 1536;
create index search_passage_3072 on search_passage
  using hnsw ((vector::halfvec(3072)) halfvec_cosine_ops) where dims = 3072;

-- A searcher's own query vectors (G7-G): theirs alone, so a hit says nothing of anybody else's text.
create table query_embedding (
  requester uuid not null references principal on delete cascade,
  text_hash text not null check (text_hash ~ '^[0-9a-f]{64}$'),
  model text not null,
  dims integer not null,
  vector halfvec not null,
  made_at timestamptz not null default now(),
  primary key (requester, text_hash, model)
);

-- Which model serves meaning, and which waits for an administrator's confirmation (G7-J).
create table embedding_state (
  only_one boolean primary key default true check (only_one),
  serving_model text,
  serving_dims integer,
  pending_model text,
  pending_endpoint uuid references model_endpoint on delete set null,
  pending_dims integer,
  confirmed_by uuid references principal on delete set null,
  confirmed_at timestamptz,
  check ((serving_model is null) = (serving_dims is null))
);

-- A vector is written once: nothing changes one, and switching models deletes passages, never these.
do $$
begin
  execute format('revoke update on embedding from %I', current_schema());
end
$$;
