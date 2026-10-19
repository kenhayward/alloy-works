import { createHash } from 'node:crypto';

import { EMBEDDING_DIMENSIONS } from '@alloy-works/domain';
import { sql } from 'kysely';
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
