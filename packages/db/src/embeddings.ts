import { createHash } from 'node:crypto';

import { EMBEDDING_DIMENSIONS } from '@alloy-works/domain';
import { sql } from 'kysely';
import { enqueueJob } from './queue.js';
import type { TenantTransaction } from './tables.js';

/**
 * The embedding store (storage-and-versioning.md, "Derived data"; the G7 plan, G7-B; VER-039): a
 * vector for a block's words, by their hash, the model and the model's version as its reply named it,
 * written once and never changed. Identical words anywhere are embedded once.
 */

export type Dimensions = (typeof EMBEDDING_DIMENSIONS)[number];

export interface StoredEmbedding {
  readonly textHash: string;
  readonly model: string;
  readonly modelVersion: string;
  readonly dims: Dimensions;
  readonly vector: readonly number[];
}

/** The hash a block's words are embedded by: their SHA-256, as hex. */
export const textHash = (words: string): string =>
  createHash('sha256').update(words, 'utf8').digest('hex');

export const isDimensions = (dims: number): dims is Dimensions =>
  (EMBEDDING_DIMENSIONS as readonly number[]).includes(dims);

/** A vector as pgvector reads one. */
export const vectorLiteral = (vector: readonly number[]): string => `[${vector.join(',')}]`;

/** Whether this schema holds the store: one before 0135 has none, and nothing is embedded. */
export async function embeddingsStored(trx: TenantTransaction): Promise<boolean> {
  const { rows } = await sql<{ found: boolean }>`
    select to_regclass(current_schema() || '.embedding') is not null as found`.execute(trx);
  return rows[0]?.found === true;
}

/** Keeps vectors, each once: one already held for its hash, model and version is left as it was. */
export async function storeEmbeddings(
  trx: TenantTransaction,
  embeddings: readonly StoredEmbedding[],
): Promise<void> {
  for (const each of embeddings) {
    if (each.vector.length !== each.dims)
      throw new Error('embedding: a vector of other dimensions');
    await sql`insert into embedding (text_hash, model, model_version, dims, vector)
      values (${each.textHash}, ${each.model}, ${each.modelVersion}, ${each.dims},
        ${vectorLiteral(each.vector)}::extensions.halfvec)
      on conflict do nothing`.execute(trx);
  }
}

/** Which of these hashes a model already holds a vector for, at any version. */
export async function embeddedHashes(
  trx: TenantTransaction,
  model: string,
  hashes: readonly string[],
): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();
  const { rows } = await sql<{ text_hash: string }>`
    select distinct text_hash from embedding
     where model = ${model} and text_hash = any(${[...new Set(hashes)]}::text[])`.execute(trx);
  return new Set(rows.map((row) => row.text_hash));
}

/** A model's vectors for these hashes, its latest version's where it has several. */
export async function readEmbeddings(
  trx: TenantTransaction,
  model: string,
  hashes: readonly string[],
): Promise<StoredEmbedding[]> {
  if (hashes.length === 0) return [];
  const { rows } = await sql<{
    text_hash: string;
    model: string;
    model_version: string;
    dims: number;
    vector: string;
  }>`
    select distinct on (text_hash) text_hash, model, model_version, dims, vector::text as vector
      from embedding
     where model = ${model} and text_hash = any(${[...new Set(hashes)]}::text[])
     order by text_hash, made_at desc`.execute(trx);
  return rows.map((row) => ({
    textHash: row.text_hash,
    model: row.model,
    modelVersion: row.model_version,
    dims: row.dims as Dimensions,
    vector: JSON.parse(row.vector) as number[],
  }));
}

/** A model to embed for: the serving one, and one pending once an administrator confirmed it (G7-J). */
export interface EmbeddingModel {
  readonly model: string;
  readonly dims: Dimensions;
  readonly endpointId: string;
}

/** Whether this schema holds the queue: one before 0136 queues nothing. */
async function queueStored(trx: TenantTransaction): Promise<boolean> {
  const { rows } = await sql<{ found: boolean }>`
    select to_regclass(current_schema() || '.embedding_queued') is not null as found`.execute(trx);
  return rows[0]?.found === true;
}

/** The models content is embedded for now: none where nothing serves or waits confirmed. */
export async function embeddingModels(trx: TenantTransaction): Promise<EmbeddingModel[]> {
  if (!(await queueStored(trx))) return [];
  const { rows } = await sql<{
    serving_model: string | null;
    serving_dims: number | null;
    serving_endpoint: string | null;
    pending_model: string | null;
    pending_dims: number | null;
    pending_endpoint: string | null;
    confirmed_at: Date | null;
  }>`select * from embedding_state`.execute(trx);
  const state = rows[0];
  if (!state) return [];
  const models: EmbeddingModel[] = [];
  if (state.serving_model && state.serving_dims && state.serving_endpoint) {
    models.push({
      model: state.serving_model,
      dims: state.serving_dims as Dimensions,
      endpointId: state.serving_endpoint,
    });
  }
  if (state.pending_model && state.pending_dims && state.pending_endpoint && state.confirmed_at) {
    models.push({
      model: state.pending_model,
      dims: state.pending_dims as Dimensions,
      endpointId: state.pending_endpoint,
    });
  }
  return models;
}

/** Sets the model meaning is served by: its first, or the one a re-embedding switched to (G7-J). */
export async function setServingEmbedding(
  trx: TenantTransaction,
  serving: EmbeddingModel | null,
): Promise<void> {
  await sql`insert into embedding_state (only_one, serving_model, serving_dims, serving_endpoint)
    values (true, ${serving?.model ?? null}, ${serving?.dims ?? null}, ${serving?.endpointId ?? null})
    on conflict (only_one) do update set serving_model = excluded.serving_model,
      serving_dims = excluded.serving_dims, serving_endpoint = excluded.serving_endpoint`.execute(
    trx,
  );
}

/** A block's words' hash, in SQL as `textHash` gives it. */
const bodyHash = sql`encode(sha256(convert_to(st.body, 'UTF8')), 'hex')`;

/**
 * Writes a passage for each block of these entries whose words a model already holds a vector for
 * (G7-C): at indexing, so a block unchanged keeps its meaning at once, and after the job embeds.
 */
export async function copyPassages(
  trx: TenantTransaction,
  entries: readonly string[],
  models: readonly EmbeddingModel[],
): Promise<void> {
  if (entries.length === 0 || models.length === 0) return;
  for (const each of models) {
    await sql`insert into search_passage (entry_id, block_id, text_hash, model, dims, vector)
      select distinct on (st.entry_id, st.place) st.entry_id, substr(st.place, 7), e.text_hash,
             e.model, e.dims, e.vector
        from search_text st
        join embedding e on e.text_hash = ${bodyHash} and e.model = ${each.model}
       where st.entry_id = any(${[...entries]}::uuid[]) and st.place like 'block:%'
       order by st.entry_id, st.place, e.made_at desc
      on conflict do nothing`.execute(trx);
  }
}

/**
 * After an artifact's latest version is indexed (G7-C, G7-F): its blocks' passages copied where their
 * vectors exist, and the artifact queued for the rest, once however often it is saved meanwhile.
 */
export async function embedIndexed(
  trx: TenantTransaction,
  artifactId: string,
  options: { readonly queue: boolean },
): Promise<void> {
  if (!(await queueStored(trx))) return;
  const models = await embeddingModels(trx);
  if (models.length === 0) return;
  const { rows: entries } = await sql<{ id: string }>`
    select id from search_entry where artifact_id = ${artifactId}`.execute(trx);
  await copyPassages(
    trx,
    entries.map((each) => each.id),
    models,
  );
  if (!options.queue) return;
  const { rows: missing } = await sql<{ found: boolean }>`
    select exists (
      select 1 from search_text st
       where st.entry_id = any(${entries.map((each) => each.id)}::uuid[])
         and st.place like 'block:%'
         and not exists (select 1 from search_passage p
           where p.entry_id = st.entry_id and p.block_id = substr(st.place, 7)
             and p.model = any(${models.map((each) => each.model)}::text[]))) as found`.execute(
    trx,
  );
  if (missing[0]?.found !== true) return;
  const { rows: queued } = await sql<{ artifact_id: string }>`
    insert into embedding_queued (artifact_id) values (${artifactId})
    on conflict do nothing returning artifact_id`.execute(trx);
  if (queued.length > 0) await enqueueJob(trx, 'embed', artifactId);
}

/** What an artifact's embedding job has to do: its entries, its blocks' words, who and where (G7-F). */
export interface EmbeddingWork {
  readonly entries: readonly string[];
  readonly texts: readonly { readonly hash: string; readonly text: string }[];
  readonly author: string | null;
  readonly documentId: string | null;
  readonly models: readonly EmbeddingModel[];
}

/** Takes an artifact off the queue and reads what its latest version has to embed. */
export async function takeEmbeddingWork(
  trx: TenantTransaction,
  artifactId: string,
): Promise<EmbeddingWork> {
  await sql`delete from embedding_queued where artifact_id = ${artifactId}`.execute(trx);
  const models = await embeddingModels(trx);
  const { rows } = await sql<{
    entry_id: string;
    body: string;
    hash: string;
    author_id: string | null;
    kind: string;
  }>`
    select st.entry_id, st.body, ${bodyHash} as hash, v.author_id, e.kind
      from search_entry e
      join search_text st on st.entry_id = e.id and st.place like 'block:%'
      left join artifact_version v on v.id = e.version_id
     where e.artifact_id = ${artifactId}`.execute(trx);
  const texts = new Map<string, string>();
  for (const row of rows) texts.set(row.hash, row.body);
  return {
    entries: [...new Set(rows.map((row) => row.entry_id))],
    texts: [...texts].map(([hash, text]) => ({ hash, text })),
    author: rows[0]?.author_id ?? null,
    documentId: rows.some((row) => row.kind === 'document') ? artifactId : null,
    models,
  };
}

/** The blocks of an artifact's latest entry holding a passage, by block, for a model or any. */
export async function passageBlocks(
  trx: TenantTransaction,
  artifactId: string,
  model?: string,
): Promise<string[]> {
  if (!(await embeddingsStored(trx))) return [];
  const { rows } = await sql<{ block_id: string }>`
    select distinct p.block_id from search_passage p join search_entry e on e.id = p.entry_id
     where e.artifact_id = ${artifactId} and e.kind <> 'section'
       ${model === undefined ? sql`` : sql`and p.model = ${model}`}
     order by p.block_id`.execute(trx);
  return rows.map((row) => row.block_id);
}

/** The model meaning is searched by, where one serves and its endpoint is set (G7-G). */
export async function servingEmbedding(
  trx: TenantTransaction,
): Promise<EmbeddingModel | undefined> {
  const models = await embeddingModels(trx);
  const { rows } = await sql<{ serving_model: string | null }>`
    select serving_model from embedding_state`.execute(trx);
  return models.find((each) => each.model === rows[0]?.serving_model);
}

/** A searcher's own vector for these words, by a model: theirs alone (G7-G). */
export async function readQueryEmbedding(
  trx: TenantTransaction,
  requester: string,
  hash: string,
  model: string,
): Promise<number[] | undefined> {
  if (!(await embeddingsStored(trx))) return undefined;
  const { rows } = await sql<{ vector: string }>`
    select vector::text as vector from query_embedding
     where requester = ${requester} and text_hash = ${hash} and model = ${model}
       and made_at > now() - interval '1 day'`.execute(trx);
  return rows[0] ? (JSON.parse(rows[0].vector) as number[]) : undefined;
}

export async function keepQueryEmbedding(
  trx: TenantTransaction,
  input: {
    readonly requester: string;
    readonly hash: string;
    readonly model: string;
    readonly dims: Dimensions;
    readonly vector: readonly number[];
  },
): Promise<void> {
  await sql`insert into query_embedding (requester, text_hash, model, dims, vector)
    values (${input.requester}, ${input.hash}, ${input.model}, ${input.dims},
      ${vectorLiteral(input.vector)}::extensions.halfvec)
    on conflict (requester, text_hash, model) do update set vector = excluded.vector,
      made_at = now()`.execute(trx);
}

/** Query vectors a day old and more go (G7-G). */
export async function sweepQueryEmbeddings(trx: TenantTransaction): Promise<number> {
  if (!(await embeddingsStored(trx))) return 0;
  const { rows } = await sql<{ n: string }>`
    with gone as (delete from query_embedding where made_at <= now() - interval '1 day' returning 1)
    select count(*) as n from gone`.execute(trx);
  return Number(rows[0]?.n ?? 0);
}

/** A person's query vectors, as they are erased: what they searched for is theirs. */
export async function eraseQueryEmbeddings(
  trx: TenantTransaction,
  principal: string,
): Promise<void> {
  if (!(await embeddingsStored(trx))) return;
  await sql`delete from query_embedding where requester = ${principal}`.execute(trx);
}
