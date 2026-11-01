import type { DerivativeKind } from '@alloy-works/domain';
import { sql } from 'kysely';
import { recordEvent } from './audit.js';
import { enqueueJob } from './queue.js';
import type { TenantTransaction } from './tables.js';

/**
 * **An image's derivatives** (0181; the AL plan, AL-H): a thumbnail and a preview of one version, made
 * by the `derive` job from its original and kept beside it, never in its place (AST-010).
 */
export interface StoredDerivative {
  readonly objectKey: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}

/** The derivative of this kind for this version, or undefined where none is made (or it was discarded). */
export async function readDerivative(
  trx: TenantTransaction,
  versionId: string,
  kind: DerivativeKind,
): Promise<StoredDerivative | undefined> {
  const row = await trx
    .selectFrom('asset_derivative')
    .select(['object_key', 'width', 'height', 'bytes'])
    .where('version_id', '=', versionId)
    .where('kind', '=', kind)
    .executeTakeFirst();
  return (
    row && { objectKey: row.object_key, width: row.width, height: row.height, bytes: row.bytes }
  );
}

/**
 * Asks the `derive` job for a version's derivatives, once however often it is asked until they are
 * made (pre-flight 5): true where this asked, false where it was already asked.
 */
export async function wantDerivatives(trx: TenantTransaction, versionId: string): Promise<boolean> {
  const asked = await trx
    .insertInto('asset_derivative_wanted')
    .values({ version_id: versionId })
    .onConflict((conflict) => conflict.column('version_id').doNothing())
    .returning('version_id')
    .executeTakeFirst();
  if (asked) await enqueueJob(trx, 'derive', versionId);
  return asked !== undefined;
}

/** The job's end: the version may be asked for again, by a read finding one discarded. */
export async function derivativesMade(trx: TenantTransaction, versionId: string): Promise<void> {
  await trx.deleteFrom('asset_derivative_wanted').where('version_id', '=', versionId).execute();
}

/**
 * A derivative the job made, kept once: a second attempt making the same one again keeps the first.
 * Never under its original's key, so discarding it can never remove the original (pre-flight 4).
 */
export async function recordDerivative(
  trx: TenantTransaction,
  input: {
    readonly versionId: string;
    readonly assetId: string;
    readonly kind: DerivativeKind;
    readonly objectKey: string;
    readonly width: number;
    readonly height: number;
    readonly bytes: number;
    readonly stripped: readonly string[];
  },
): Promise<void> {
  const original = await trx
    .selectFrom('artifact_version')
    .select(sql<string>`content ->> 'object'`.as('object'))
    .where('id', '=', input.versionId)
    .executeTakeFirst();
  if (original?.object === input.objectKey) {
    throw new Error(`A derivative of ${input.versionId} is its original, so it is not kept as one`);
  }
  await trx
    .insertInto('asset_derivative')
    .values({
      version_id: input.versionId,
      asset_id: input.assetId,
      kind: input.kind,
      object_key: input.objectKey,
      width: input.width,
      height: input.height,
      bytes: input.bytes,
      stripped: [...input.stripped],
    })
    .onConflict((conflict) => conflict.columns(['version_id', 'kind']).doNothing())
    .execute();
}

/**
 * Discards every derivative of a space's images (AST-048), answering their keys for the caller to
 * remove where nothing else holds them. Each is made again from its original when next read.
 */
export async function discardDerivatives(
  trx: TenantTransaction,
  spaceId: string,
): Promise<string[]> {
  const rows = await trx
    .deleteFrom('asset_derivative')
    .where('asset_id', 'in', (inner) =>
      inner.selectFrom('artifact').select('id').where('space_id', '=', spaceId),
    )
    .returning('object_key')
    .execute();
  const space = await trx
    .selectFrom('space')
    .select('name')
    .where('id', '=', spaceId)
    .executeTakeFirst();
  await recordEvent(
    trx,
    {
      kind: 'asset.derivatives_discarded',
      subject: { kind: 'space', id: spaceId },
      space: spaceId,
      detail: { count: rows.length },
    },
    [{ role: 'subject', text: space?.name ?? spaceId, refersTo: spaceId }],
  );
  return [...new Set(rows.map((row) => row.object_key))];
}
