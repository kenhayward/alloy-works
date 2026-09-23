import {
  ASSET_SCHEMA_VERSION,
  assetAlternativeSchema,
  parseAssetVersion,
  type AssetAlternative,
  type AssetFormat,
  type AssetVersionContent,
  type ImageHeader,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { enqueueJob } from './queue.js';
import type { TenantTransaction } from './tables.js';
import { createArtifact, readVersion, type StoredVersion } from './versions.js';

/** Why an upload was refused: at the door by the service, or by the `ingest` job's decode. */
export type AssetUploadReason =
  | 'not_permitted'
  | 'too_large'
  | 'too_many_pixels'
  | 'malformed'
  | 'undecodable'
  /** The job's last attempt failed for the store's or the database's reasons, never the bytes'. */
  | 'unchecked';

export type AssetUploadState = 'awaiting' | 'checking' | 'ready' | 'refused';

/** One upload, as its uploader follows it (docs/design/assets.md, "The upload and the check"). */
export interface StoredAssetUpload {
  readonly id: string;
  readonly spaceId: string;
  readonly uploader: string;
  readonly alternative: AssetAlternative | null;
  readonly state: AssetUploadState;
  readonly objectKey: string | null;
  readonly format: AssetFormat | null;
  readonly bytes: number | null;
  readonly reason: AssetUploadReason | null;
  readonly assetId: string | null;
  readonly assetVersionId: string | null;
  readonly createdAt: Date;
}

/** An asset version, with the space its asset is in: what the routes read and decide on. */
export interface StoredAssetVersion {
  readonly id: string;
  readonly assetId: string;
  readonly spaceId: string;
  readonly number: string;
  readonly content: AssetVersionContent;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type UploadRow = {
  id: string;
  space_id: string;
  uploader: string;
  alternative: unknown;
  state: AssetUploadState;
  object_key: string | null;
  format: AssetFormat | null;
  bytes: number | null;
  reason: AssetUploadReason | null;
  asset_id: string | null;
  asset_version_id: string | null;
  created_at: Date;
};

const uploadOf = (row: UploadRow): StoredAssetUpload => ({
  id: row.id,
  spaceId: row.space_id,
  uploader: row.uploader,
  alternative: row.alternative === null ? null : assetAlternativeSchema.parse(row.alternative),
  state: row.state,
  objectKey: row.object_key,
  format: row.format,
  bytes: row.bytes,
  reason: row.reason,
  assetId: row.asset_id,
  assetVersionId: row.asset_version_id,
  createdAt: row.created_at,
});

/**
 * Makes an upload in a space, awaiting its bytes, with the description its uploader gave or none.
 * The caller has decided `create` in the space; the description is parsed here, so nothing but a
 * well-formed one is ever written.
 */
export async function createAssetUpload(
  trx: TenantTransaction,
  input: {
    readonly spaceId: string;
    readonly uploader: string;
    readonly alternative: AssetAlternative | null;
  },
): Promise<StoredAssetUpload> {
  const alternative =
    input.alternative === null ? null : assetAlternativeSchema.parse(input.alternative);
  const row = await trx
    .insertInto('asset_upload')
    .values({
      space_id: input.spaceId,
      uploader: input.uploader,
      alternative: alternative === null ? null : JSON.stringify(alternative),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return uploadOf(row);
}

/** An upload by its id, or undefined when this tenant holds none by that id. */
export async function readAssetUpload(
  trx: TenantTransaction,
  id: string,
): Promise<StoredAssetUpload | undefined> {
  if (!UUID.test(id)) return undefined;
  const row = await trx
    .selectFrom('asset_upload')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row && uploadOf(row);
}

/**
 * Records the bytes an awaiting upload was filled with - already stored under their hash, and already
 * read at the door - moves it to `checking`, and queues the job that proves them, in one transaction.
 */
export async function receiveAssetBytes(
  trx: TenantTransaction,
  id: string,
  bytes: { readonly key: string; readonly format: AssetFormat; readonly bytes: number },
): Promise<StoredAssetUpload> {
  const row = await trx
    .updateTable('asset_upload')
    .set({ state: 'checking', object_key: bytes.key, format: bytes.format, bytes: bytes.bytes })
    .where('id', '=', id)
    .where('state', '=', 'awaiting')
    .returningAll()
    .executeTakeFirst();
  if (!row) throw new Error(`Upload ${id} is not awaiting its bytes`);
  await enqueueJob(trx, 'ingest', id);
  return uploadOf(row);
}

/**
 * The `ingest` job's success: the asset, in the upload's space, at version 0.1 by its uploader, with
 * what the check read and the description the uploader gave; and the upload `ready`, naming it. One
 * transaction, so an upload is never ready without its asset or the other way round.
 */
export async function recordAsset(
  trx: TenantTransaction,
  id: string,
  header: ImageHeader,
): Promise<StoredVersion> {
  const upload = await readAssetUpload(trx, id);
  if (!upload || upload.state !== 'checking') throw new Error(`Upload ${id} is not being checked`);
  if (header.format !== upload.format) {
    throw new Error(`Upload ${id} arrived as ${upload.format} and was read as ${header.format}`);
  }
  const content = parseAssetVersion({
    schemaVersion: ASSET_SCHEMA_VERSION,
    object: upload.objectKey,
    format: header.format,
    bytes: upload.bytes,
    width: header.width,
    height: header.height,
    orientation: header.orientation,
    colour: header.colour,
    alpha: header.alpha,
    depth: header.depth,
    resolution: header.resolution,
    alternative: upload.alternative,
  });
  const version = await createArtifact(trx, {
    spaceId: upload.spaceId,
    author: upload.uploader,
    substance: { kind: 'asset', content },
  });
  await trx
    .updateTable('asset_upload')
    .set({
      state: 'ready',
      asset_id: version.artifactId,
      asset_version_id: version.id,
      finished_at: new Date(),
    })
    .where('id', '=', id)
    .execute();
  return version;
}

/** Refuses an upload, at the door or after its check, saying why. The caller removes its bytes. */
export async function refuseAssetUpload(
  trx: TenantTransaction,
  id: string,
  reason: AssetUploadReason,
): Promise<StoredAssetUpload> {
  const row = await trx
    .updateTable('asset_upload')
    .set({ state: 'refused', reason, finished_at: new Date() })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst();
  if (!row) throw new Error(`No upload ${id}`);
  return uploadOf(row);
}

/**
 * Whether any asset version names this object. A key is the bytes' hash, so a second upload of bytes
 * already made into an asset shares its key, and a refusal of the second must not remove them.
 */
export async function objectNamedByAsset(trx: TenantTransaction, key: string): Promise<boolean> {
  const row = await trx
    .selectFrom('artifact_version')
    .select('id')
    .where('kind', '=', 'asset')
    .where(sql<boolean>`content ->> 'object' = ${key}`)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

/** An asset version and its asset's space, or undefined when this tenant holds no such version. */
export async function readAssetVersion(
  trx: TenantTransaction,
  id: string,
): Promise<StoredAssetVersion | undefined> {
  const version = await readVersion(trx, id);
  if (!version || version.kind !== 'asset') return undefined;
  const artifact = await trx
    .selectFrom('artifact')
    .select('space_id')
    .where('id', '=', version.artifactId)
    .executeTakeFirstOrThrow();
  return {
    id: version.id,
    assetId: version.artifactId,
    spaceId: artifact.space_id!,
    number: `${version.revision}.${version.version}`,
    content: parseAssetVersion(version.content),
  };
}
