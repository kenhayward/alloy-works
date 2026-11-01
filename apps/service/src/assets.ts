import type {
  AssetParams,
  AssetRightsView,
  AssetUploadParams,
  AssetUploadView,
  AssetVersionParams,
  AssetVersionView,
  CreateAssetUploadBody,
  SetAssetRightsBody,
} from '@alloy-works/api-contract';
import { createHash } from 'node:crypto';
import {
  createAssetUpload,
  documentsHoldingAsset,
  holdObject,
  readAssetRights,
  readAssetUpload,
  readAssetVersion,
  readDefinitionLatest,
  receiveAssetBytes,
  recordAssetRights,
  imagesPolicy,
  refuseAssetUpload,
  type AssetUploadReason,
  type StoredAssetUpload,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import {
  ADMITTED_FORMATS,
  ASSET_MAX_BYTES,
  byteLimitOf,
  decide,
  readImageHeader,
} from '@alloy-works/domain';
import type { ObjectStores } from '@alloy-works/objects';
import type { FastifyRequest } from 'fastify';
import {
  authoriseAt,
  callerOf,
  notFound,
  refusedBy,
  type Authorised,
  type Caller,
} from './access.js';
import { contextOf } from './audit.js';
import { connectionFacts } from './data/sql-access.js';
import { AppError, storageUnavailable } from './errors.js';
import type { SessionPrincipal } from './sessions.js';
import { refused } from './wire-codes.js';

const licenceMissing = () =>
  refused(422, 'asset.licence_missing', 'The licence named is no licence of this environment.');

/** An asset's rights now and every change to them, with who made each by name (AL-C). */
async function rightsView(trx: TenantTransaction, asset: string): Promise<AssetRightsView> {
  const history = await readAssetRights(trx, asset);
  const by = [...new Set(history.map((each) => each.recordedBy))];
  const people =
    by.length === 0
      ? []
      : await trx
          .selectFrom('principal')
          .select(['id', 'display_name'])
          .where('id', 'in', by)
          .execute();
  const names = new Map(people.map((each) => [each.id, each.display_name]));
  return {
    asset,
    // An image recorded before 0180 has none: it was never declared.
    current: history[0]?.rights ?? { kind: 'undeclared' },
    history: history.map((each) => ({
      rights: each.rights,
      by: { id: each.recordedBy, name: names.get(each.recordedBy) ?? '' },
      at: each.recordedAt.toISOString(),
    })),
  };
}

/** The asset by its id, as an asset: not found where the id is another kind's. */
async function assetIn(trx: TenantTransaction, id: string): Promise<void> {
  const artifact = await trx
    .selectFrom('artifact')
    .select('kind')
    .where('id', '=', id)
    .executeTakeFirst();
  if (artifact?.kind !== 'asset') throw notFound();
}

/** Bytes a permission-checked route answers with, sent after its transaction commits (figures 1, R2). */
export interface BinaryBody {
  readonly contentType: string;
  readonly bytes: Buffer;
  /** Whether the bytes can never change, so a browser may keep them for a year. */
  readonly immutable: boolean;
  /** Saved under this name rather than shown, and never kept (the R17 plan, R17-E). */
  readonly attachment?: string;
  /**
   * Shown in place under this policy, which must sandbox it, and never kept: tenant HTML, to a reader
   * inside the organisation (the HT plan, HT-M).
   */
  readonly shownUnder?: string;
}

const uploadView = (upload: StoredAssetUpload): AssetUploadView => ({
  id: upload.id,
  space: upload.spaceId,
  state: upload.state,
  reason: upload.reason,
  assetVersion: upload.assetVersionId,
});

/**
 * What each refusal at the door is on the wire, and what the upload records, with the asset rule
 * that refuses it (API-006): the format list, the bound on what a file expands to, and the strict
 * parse of its structure.
 */
export const REFUSED_AT_THE_DOOR = {
  not_permitted: {
    status: 400,
    code: 'asset_format_not_permitted',
    message: 'This is not a PNG or a JPEG image. Only those can be placed in a component.',
    rule: 'AST-001',
  },
  too_many_pixels: {
    status: 413,
    code: 'asset_too_large',
    message: 'This image has more than 50 million pixels, which is more than an image may have.',
    rule: 'AST-040',
  },
  too_large: {
    status: 413,
    code: 'asset_too_large',
    message: 'This image is larger than this environment allows an image of its format to be.',
    rule: 'AST-004',
  },
  malformed: {
    status: 400,
    code: 'asset_unreadable',
    message: 'This is not a complete PNG or JPEG image.',
    rule: 'AST-051',
  },
} as const satisfies Partial<Record<AssetUploadReason, object>>;

/**
 * An asset as a route reads it: `read` on it was decided by the route; an asset a dataset's image
 * made is read only by a caller who may also read a document holding it, as every value a result
 * returns is (the D8 plan, D8-I), and is otherwise not found, as an asset they may not read is.
 * Answers whether it is a dataset's.
 */
async function readableAsset(
  trx: TenantTransaction,
  caller: Caller,
  assetId: string,
): Promise<{ readonly fromDataset: boolean }> {
  const holders = await documentsHoldingAsset(trx, assetId);
  if (holders === undefined) return { fromDataset: false };
  let refusal: AppError | undefined;
  for (const document of holders) {
    const facts = await connectionFacts(trx, caller, document);
    if (!facts) continue;
    const reading = decide('read', facts);
    if (reading.allowed) return { fromDataset: true };
    // The image exists, and no document the caller may read holds it: a refusal, hidden (AU1-E),
    // by the first holding document's decision.
    refusal ??= refusedBy(notFound(), reading, facts, { kind: 'artifact', id: assetId }, true);
  }
  throw refusal ?? notFound();
}

/** An asset version as a route reads it, by its asset's rule. */
async function readableAssetVersion(trx: TenantTransaction, caller: Caller, id: string) {
  const version = await readAssetVersion(trx, id);
  if (!version) throw notFound();
  await readableAsset(trx, caller, version.assetId);
  return version;
}

/**
 * Uploading an image into a space, following its check, and reading what it made
 * (docs/design/assets.md, "Reading an asset"). An upload is its uploader's alone: anybody else is
 * told there is no such upload, as a publication request is.
 */
export function assetHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
  objects: ObjectStores | undefined,
) {
  /** The upload by its id, if the caller made it; not found otherwise, whoever made it. */
  const theirs = async (request: FastifyRequest, trx: TenantTransaction) => {
    const { id } = request.params as AssetUploadParams;
    const upload = await readAssetUpload(trx, id);
    if (!upload || upload.uploader !== principalOf(request).principalId) throw notFound();
    return upload;
  };

  return {
    /** `create` was decided on the space by `authorise`, in `trx`; the upload is made in it. */
    createAssetUpload: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<AssetUploadView> => {
      const { space } = request.params as { space: string };
      const body = request.body as CreateAssetUploadBody;
      // A licence declared at upload is one of this environment (AST-044; AL-E).
      if (
        body.rights?.kind === 'declared' &&
        (await readDefinitionLatest(trx, body.rights.licence))?.kind !== 'licence'
      ) {
        throw licenceMissing();
      }
      return uploadView(
        await createAssetUpload(trx, {
          spaceId: space,
          uploader: principalId,
          alternative: body.alternative,
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.rights === undefined ? {} : { rights: body.rights }),
        }),
      );
    },

    /**
     * The service's half of the check (assets.md, "The upload and the check"): the format from the
     * bytes, the header walk, the pixel limit - each refused with nothing stored, the refusal recorded
     * on the upload - then the bytes kept under their hash and the `ingest` job queued. A refusal is
     * committed before it is answered, so the upload says why even though the request failed.
     */
    putAssetUploadBytes: async (request: FastifyRequest): Promise<AssetUploadView> => {
      const tenant = tenantOf(request);
      // Bytes, or nothing is read at all: a JSON or text body, or none, is not an image that failed its
      // check, and must not burn the upload as one would. Asked after the upload is found to be the
      // caller's, so an upload that is not is not found, whatever was sent (IAM-004's harness).
      const bytes =
        Buffer.isBuffer(request.body) &&
        request.headers['content-type']?.split(';')[0]?.trim() === 'application/octet-stream'
          ? request.body
          : undefined;
      if (bytes !== undefined && bytes.length > ASSET_MAX_BYTES) {
        throw new AppError(413, 'asset_too_large', 'This file is larger than an image may be.');
      }
      const filled = () =>
        new AppError(409, 'asset_upload_filled', 'This upload already has its image.');
      const outcome = await db.withTenant(
        tenant,
        async (trx) => {
          const upload = await theirs(request, trx);
          // `create` in the space, decided again now that something will be made in it: a grant
          // removed since the upload was made stops it here (final review, finding 6).
          await authoriseAt(trx, callerOf(request), 'create', {
            kind: 'space',
            id: upload.spaceId,
          });
          if (bytes === undefined) {
            throw new AppError(
              415,
              'asset_bytes_expected',
              "Send the image's bytes as application/octet-stream.",
            );
          }
          if (upload.state !== 'awaiting') {
            // The same image again - a retry after a lost answer - is answered with the upload as it
            // stands (service-foundations.md, "Idempotency"; ID-D): its object is named by the image's
            // own hash. Any other bytes for an upload already filled are refused.
            const again = readImageHeader(bytes);
            const hash = again.ok
              ? createHash('sha256').update(bytes.subarray(0, again.header.end)).digest('hex')
              : undefined;
            if (hash !== undefined && upload.objectKey?.endsWith(`/sha256/${hash}`)) {
              return { upload } as const;
            }
            throw filled();
          }
          const read = readImageHeader(bytes);
          if (!read.ok) {
            if (!(await refuseAssetUpload(trx, upload.id, read.refusal, 'awaiting')))
              throw filled();
            return { refused: REFUSED_AT_THE_DOOR[read.refusal] } as const;
          }
          // Its format's limit, as this environment has it (AST-004): refused and recorded, as the
          // header's refusals are.
          const { limits } = await imagesPolicy(trx);
          if (read.header.end > byteLimitOf(read.header.format, limits)) {
            if (!(await refuseAssetUpload(trx, upload.id, 'too_large', 'awaiting')))
              throw filled();
            return { refused: REFUSED_AT_THE_DOOR.too_large } as const;
          }
          if (!objects) throw storageUnavailable();
          // The image alone: whatever follows its end - a phone's second picture or motion clip, or a
          // file hidden in a polyglot - is left behind here and never stored (final review, findings 1
          // and 2). Held by its hash while it is stored, so no refusal of another upload of the same
          // image can remove it in between.
          const image = bytes.subarray(0, read.header.end);
          await holdObject(trx, createHash('sha256').update(image).digest('hex'));
          const store = await objects.forTenant(trx, tenant);
          const format = read.header.format;
          const stored = await store.put(image, ADMITTED_FORMATS[format].contentType);
          const received = await receiveAssetBytes(trx, upload.id, {
            key: stored.key,
            format,
            bytes: stored.size,
          });
          if (!received) throw filled();
          return { upload: received } as const;
          // As the uploader: a refusal at the door is theirs on the log (the AU1 plan, AU1-L).
        },
        contextOf(request),
      );
      if ('refused' in outcome) {
        const { status, code, message, rule } = outcome.refused;
        throw new AppError(status, code, message, rule);
      }
      return uploadView(outcome.upload);
    },

    getAssetUpload: async (request: FastifyRequest): Promise<AssetUploadView> =>
      db.withTenant(tenantOf(request), async (trx) => uploadView(await theirs(request, trx))),

    /** `read` was decided on the asset the version belongs to. */
    getAssetVersion: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<AssetVersionView> => {
      const { id } = request.params as AssetVersionParams;
      const version = await readableAssetVersion(trx, callerOf(request), id);
      const { content } = version;
      return {
        id: version.id,
        asset: version.assetId,
        number: version.number,
        format: content.format,
        bytes: content.bytes,
        width: content.width,
        height: content.height,
        resolution: content.resolution,
        alternative: content.alternative && { ...content.alternative },
        name: content.name ?? null,
      };
    },

    /** `read` was decided on the asset (AL-C); an id of another kind is no asset's. */
    getAssetRights: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<AssetRightsView> => {
      const { id } = request.params as AssetParams;
      await assetIn(trx, id);
      await readableAsset(trx, callerOf(request), id);
      return rightsView(trx, id);
    },

    /** `edit` was decided on the asset; the change is a row of its own (AST-031), audited. */
    setAssetRights: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<AssetRightsView> => {
      const { id } = request.params as AssetParams;
      await assetIn(trx, id);
      // A dataset's image, by its upload rather than its rights row, which a migration may not have
      // written (the ALb review, 3).
      if ((await readableAsset(trx, callerOf(request), id)).fromDataset) {
        throw refused(
          409,
          'asset.rights_dataset',
          "A dataset's image takes its source from its dataset.",
        );
      }
      const answer = await recordAssetRights(trx, {
        assetId: id,
        rights: (request.body as SetAssetRightsBody).rights,
        by: principalId,
      });
      if (answer.answer === 'licence.missing') throw licenceMissing();
      if (answer.answer === 'rights.invalid') throw notFound();
      return rightsView(trx, id);
    },

    /**
     * The bytes, by the service rather than a signed link to the store (decision F-G): a link expires
     * under an editor open for hours, and this keeps the store's address out of the renderer.
     */
    getAssetVersionContent: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<BinaryBody> => {
      const { id } = request.params as AssetVersionParams;
      const version = await readableAssetVersion(trx, callerOf(request), id);
      if (!objects) throw storageUnavailable();
      const store = await objects.forTenant(trx, tenantOf(request));
      return {
        contentType: ADMITTED_FORMATS[version.content.format].contentType,
        bytes: await store.get(version.content.object),
        immutable: true,
      };
    },
  };
}
