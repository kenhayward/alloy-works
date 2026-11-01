import { createHash } from 'node:crypto';
import {
  derivativesMade,
  readAssetVersion,
  readDerivative,
  recordDerivative,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  ASSET_DERIVATIVES,
  ASSET_MAX_PIXELS,
  DERIVATIVE_KINDS,
  stripImage,
} from '@alloy-works/domain';
import type { ObjectStores } from '@alloy-works/objects';
import sharp from 'sharp';
import type { JobHandler } from '../worker.js';

/**
 * **An image's derivatives** (the AL plan, AL-H; AST-008, AST-010, AST-048): its thumbnail and preview,
 * made from the original's stripped bytes, held first to their hash - never from another derivative -
 * turned upright, never enlarged, WebP, kept beside the original by version. A kind already made is
 * left as it is, so a second attempt finishes what the first did not. Its end, made or failed, lets a
 * read ask again.
 */
export function deriveJob(deps: {
  readonly db: TenantDatabase;
  readonly stores: ObjectStores;
}): JobHandler {
  return {
    async run(tenant, job) {
      if (job.subjectId === null) return;
      const versionId = job.subjectId;
      const found = await deps.db.withTenant(tenant, async (trx) => ({
        version: await readAssetVersion(trx, versionId),
        store: await deps.stores.forTenant(trx, tenant),
      }));
      const { version, store } = found;
      if (version) {
        const key = version.content.object;
        const original = await store.get(key);
        if (!key.endsWith(`/sha256/${createHash('sha256').update(original).digest('hex')}`)) {
          // The store's fault, not the image's: tried again, and the original is never derived from.
          throw new Error('The stored bytes do not match their key');
        }
        const stripped = stripImage(original);
        for (const kind of DERIVATIVE_KINDS) {
          if (await deps.db.withTenant(tenant, (trx) => readDerivative(trx, versionId, kind))) {
            continue;
          }
          const { longSide } = ASSET_DERIVATIVES[kind];
          const made = await sharp(stripped.bytes, { limitInputPixels: ASSET_MAX_PIXELS })
            .rotate()
            .resize({ width: longSide, height: longSide, fit: 'inside', withoutEnlargement: true })
            .webp()
            .toBuffer({ resolveWithObject: true });
          const kept = await store.put(made.data, 'image/webp');
          await deps.db.withTenant(tenant, (trx) =>
            recordDerivative(trx, {
              versionId,
              assetId: version.assetId,
              kind,
              objectKey: kept.key,
              width: made.info.width,
              height: made.info.height,
              bytes: kept.size,
              stripped: stripped.found,
            }),
          );
        }
      }
      await deps.db.withTenant(tenant, (trx) => derivativesMade(trx, versionId));
    },

    /** Given up: the original is still served, and the next read asks again (pre-flight 5). */
    async failed(tenant, job) {
      if (job.subjectId === null) return;
      await deps.db.withTenant(tenant, (trx) => derivativesMade(trx, job.subjectId!));
    },
  };
}
