import { REFERENCE_SOURCE_IDS, type ReferenceSourceId } from '@alloy-works/domain';
import type { TenantTransaction } from './tables.js';

/**
 * Whether each declared reference source is on for the tenant (the XR plan, XR-C): on unless an
 * administrator switched it off.
 */
export async function referenceSourcesOn(
  trx: TenantTransaction,
): Promise<Record<ReferenceSourceId, boolean>> {
  const rows = await trx
    .selectFrom('reference_source_policy')
    .select(['source', 'enabled'])
    .execute();
  const switched = new Map(rows.map((row) => [row.source, row.enabled]));
  return Object.fromEntries(
    REFERENCE_SOURCE_IDS.map((id) => [id, switched.get(id) ?? true]),
  ) as Record<ReferenceSourceId, boolean>;
}

/** Switches a source on or off for the tenant. */
export async function setReferenceSource(
  trx: TenantTransaction,
  source: ReferenceSourceId,
  enabled: boolean,
): Promise<void> {
  await trx
    .insertInto('reference_source_policy')
    .values({ source, enabled })
    .onConflict((conflict) => conflict.column('source').doUpdateSet({ enabled }))
    .execute();
}
