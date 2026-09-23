import { createHash } from 'node:crypto';
import {
  objectNamedByAsset,
  readAssetUpload,
  recordAsset,
  refuseAssetUpload,
  type AssetUploadReason,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { ASSET_MAX_PIXELS, readImageHeader, type ImageHeader } from '@alloy-works/domain';
import type { ObjectStores, TenantStore } from '@alloy-works/objects';
import sharp from 'sharp';
import { JobRefused } from '../refusal.js';
import type { JobHandler } from '../worker.js';

/**
 * What the decoder makes of an image: its dimensions as stored and its EXIF orientation, or that it
 * does not decode. Injected, so a test can stand in a decoder that refuses what sharp would take.
 */
export type Decode = (
  bytes: Buffer,
) => Promise<{ ok: true; width: number; height: number; orientation: number } | { ok: false }>;

/**
 * sharp 0.35.4, pinned (decision F-D): the whole image decoded under the pixel limit, failing on any
 * error a decoder reports - a truncated JPEG, a PNG whose data does not inflate. Measured: a
 * 30000 by 30000 PNG is refused by `limitInputPixels` in a millisecond, without allocating it.
 */
export const decodeWithSharp: Decode = async (bytes) => {
  const options = { limitInputPixels: ASSET_MAX_PIXELS, failOn: 'error' } as const;
  try {
    const metadata = await sharp(bytes, options).metadata();
    const { info } = await sharp(bytes, options).raw().toBuffer({ resolveWithObject: true });
    return {
      ok: true,
      width: info.width,
      height: info.height,
      orientation: metadata.orientation ?? 1,
    };
  } catch {
    return { ok: false };
  }
};

/** The decoder's dimensions, turned as the walk turns them, must be the walk's (assets.md). */
const agrees = (
  header: ImageHeader,
  decoded: { width: number; height: number; orientation: number },
) => {
  const turned = decoded.orientation >= 5;
  const width = turned ? decoded.height : decoded.width;
  const height = turned ? decoded.width : decoded.height;
  return (
    width === header.width && height === header.height && decoded.orientation === header.orientation
  );
};

/**
 * The worker's half of the check (docs/design/assets.md, "The upload and the check"): the bytes read
 * back from the store and held to their key's hash, walked again - a job never trusts what the service
 * decided - decoded whole, and the two readings compared. Then the asset is recorded, or the upload is
 * refused and its bytes removed, unless an asset already has the same bytes.
 */
export function ingestJob(deps: {
  readonly db: TenantDatabase;
  readonly stores: ObjectStores;
  readonly decode?: Decode;
}): JobHandler {
  const decode = deps.decode ?? decodeWithSharp;

  /** Why the decode refuses bytes the walk accepted, or undefined where it agrees with the walk. */
  const refusalOfDecode = async (
    header: ImageHeader,
    bytes: Buffer,
  ): Promise<AssetUploadReason | undefined> => {
    const decoded = await decode(bytes);
    if (!decoded.ok) return 'undecodable';
    return agrees(header, decoded) ? undefined : 'malformed';
  };

  /** Refuses the upload, then removes its bytes once the refusal has committed. */
  const refuse = async (
    tenant: Tenant,
    store: TenantStore,
    id: string,
    key: string | null,
    reason: AssetUploadReason,
  ) => {
    const named = await deps.db.withTenant(tenant, async (trx) => {
      await refuseAssetUpload(trx, id, reason);
      return key !== null && (await objectNamedByAsset(trx, key));
    });
    if (key !== null && !named) await store.remove(key);
  };

  return {
    async run(tenant, job) {
      const found = await deps.db.withTenant(tenant, async (trx) => ({
        upload: job.subjectId === null ? undefined : await readAssetUpload(trx, job.subjectId),
        store: await deps.stores.forTenant(trx, tenant),
      }));
      const { upload, store } = found;
      // Nothing to do: another attempt already finished it.
      if (!upload || upload.state !== 'checking' || upload.objectKey === null) return;
      const bytes = await store.get(upload.objectKey);
      if (
        !upload.objectKey.endsWith(`/sha256/${createHash('sha256').update(bytes).digest('hex')}`)
      ) {
        // The store answered with other bytes than the key names: a fault of the store, not of the
        // upload, so the job fails and is tried again rather than refusing the author's image.
        throw new Error('The stored bytes do not match their key');
      }
      const walked = readImageHeader(bytes);
      const refusal = walked.ok ? await refusalOfDecode(walked.header, bytes) : walked.refusal;
      if (refusal !== undefined || !walked.ok) {
        await refuse(tenant, store, upload.id, upload.objectKey, refusal ?? 'malformed');
        // Refused on its merits: the same bytes fail the same way every time (issue #146).
        throw new JobRefused('asset_refused', 'The upload is not an image the product admits');
      }
      await deps.db.withTenant(tenant, (trx) => recordAsset(trx, upload.id, walked.header));
    },

    /** The last attempt failed for the store's or the database's reasons: never left checking. */
    async failed(tenant, job) {
      if (job.subjectId === null) return;
      const found = await deps.db.withTenant(tenant, async (trx) => ({
        upload: await readAssetUpload(trx, job.subjectId!),
        store: await deps.stores.forTenant(trx, tenant),
      }));
      if (found.upload?.state !== 'checking') return;
      await refuse(tenant, found.store, found.upload.id, found.upload.objectKey, 'unchecked');
    },
  };
}
