import {
  ASSET_SCHEMA_VERSION,
  assetAlternativeSchema,
  assetRightsSchema,
  parseAssetVersion,
  type AssetAlternative,
  type AssetRights,
  type AssetFormat,
  type AssetVersionContent,
  type ImageHeader,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { labelled, labels, recordEvent, type AuditEvent } from './audit.js';
import { enqueueJob } from './queue.js';
import { indexVersion } from './search.js';
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
  /** The file's name, and what its uploader declared of its rights, where they gave them (AL-D, AL-E). */
  readonly name: string | null;
  readonly rights: AssetRights | null;
  /** A person's upload, or an image a dataset's result holds (D8-D). */
  readonly origin: 'upload' | 'dataset';
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
  /** Absent short of 0180, as on every upload before it. */
  name?: string | null;
  rights?: unknown;
  origin: 'upload' | 'dataset';
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
  name: row.name ?? null,
  rights: row.rights == null ? null : assetRightsSchema.parse(row.rights),
  origin: row.origin,
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
    readonly name?: string;
    /** Declared at upload (AST-044); a dataset's kind is never a person's to declare. */
    readonly rights?: Exclude<AssetRights, { kind: 'dataset' }>;
  },
): Promise<StoredAssetUpload> {
  const alternative =
    input.alternative === null ? null : assetAlternativeSchema.parse(input.alternative);
  const rights = input.rights === undefined ? undefined : assetRightsSchema.parse(input.rights);
  if (rights?.kind === 'dataset') throw new Error('A dataset image is never uploaded by a person');
  const row = await trx
    .insertInto('asset_upload')
    .values({
      space_id: input.spaceId,
      uploader: input.uploader,
      alternative: alternative === null ? null : JSON.stringify(alternative),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(rights === undefined ? {} : { rights: JSON.stringify(rights) }),
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
 * Holds the bytes of this hash for the rest of the transaction: storing them for an upload and
 * removing them for a refusal each take it, so one never removes what the other has just kept for a
 * second upload of the same image (final review, finding 5).
 */
export async function holdObject(trx: TenantTransaction, sha256: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`alloy-works:object:${sha256}`}, 0))`.execute(
    trx,
  );
}

/**
 * Records the bytes an awaiting upload was filled with - already stored under their hash, and already
 * read at the door - moves it to `checking`, and queues the job that proves them, in one transaction.
 * Undefined where the upload is no longer awaiting: a second request filling it lost the race. An
 * import's image is checked by the import's own job as it reads the file (IMc), so is not queued.
 */
export async function receiveAssetBytes(
  trx: TenantTransaction,
  id: string,
  bytes: { readonly key: string; readonly format: AssetFormat; readonly bytes: number },
  queued = true,
): Promise<StoredAssetUpload | undefined> {
  const row = await trx
    .updateTable('asset_upload')
    .set({ state: 'checking', object_key: bytes.key, format: bytes.format, bytes: bytes.bytes })
    .where('id', '=', id)
    .where('state', '=', 'awaiting')
    .returningAll()
    .executeTakeFirst();
  if (!row) return undefined;
  if (queued) await enqueueJob(trx, 'ingest', id);
  return uploadOf(row);
}

/**
 * The upload admitting an image a dataset's result holds into a space (the D8 plan, D8-D): the one
 * already checking those bytes there, shared, or one made for it - `origin: 'dataset'`, no
 * description, by the person whose act ran the result - moved to `checking` with the bytes already
 * stored under their hash and read, and its `ingest` queued. The caller holds the bytes' hash
 * (`holdObject`) from before it stored them, so two acts on one image share one upload, and no refusal
 * removes the bytes in between.
 */
export async function uploadForDatasetImage(
  trx: TenantTransaction,
  input: {
    readonly spaceId: string;
    readonly uploader: string;
    readonly key: string;
    readonly format: AssetFormat;
    readonly bytes: number;
  },
): Promise<{ readonly upload: StoredAssetUpload; readonly shared: boolean }> {
  const checking = await trx
    .selectFrom('asset_upload')
    .selectAll()
    .where('space_id', '=', input.spaceId)
    .where('object_key', '=', input.key)
    .where('state', '=', 'checking')
    .orderBy('created_at')
    .limit(1)
    .executeTakeFirst();
  if (checking) return { upload: uploadOf(checking), shared: true };
  const made = await trx
    .insertInto('asset_upload')
    .values({
      space_id: input.spaceId,
      uploader: input.uploader,
      alternative: null,
      origin: 'dataset',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const received = await receiveAssetBytes(trx, made.id, {
    key: input.key,
    format: input.format,
    bytes: input.bytes,
  });
  if (!received) throw new Error(`Upload ${made.id} was filled before it was made`);
  return { upload: received, shared: false };
}

/**
 * The `ingest` job's success: the asset, in the upload's space, at version 0.1 by its uploader, with
 * what the check read and the description the uploader gave; and the upload `ready`, naming it. One
 * transaction, so an upload is never ready without its asset or the other way round. A delivery's
 * image carries the delivery's note on its version, as every version it writes does (API-071).
 */
export async function recordAsset(
  trx: TenantTransaction,
  id: string,
  header: ImageHeader,
  options: { readonly note?: string } = {},
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
    ...(upload.name === null ? {} : { name: upload.name }),
  });
  const version = await createArtifact(trx, {
    spaceId: upload.spaceId,
    author: upload.uploader,
    ...(options.note === undefined ? {} : { note: options.note }),
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
  // Its first rights (AL-C): what the uploader declared, a dataset's for a dataset's image, else
  // undeclared, so every asset, however it arrived, has one (the pre-flight's sixth finding).
  await trx
    .insertInto('asset_rights')
    .values({
      asset_id: version.artifactId,
      rights: JSON.stringify(
        upload.origin === 'dataset'
          ? { kind: 'dataset' }
          : (upload.rights ?? { kind: 'undeclared' }),
      ),
      recorded_by: upload.uploader,
    })
    .execute();
  // Indexed as it was written, before the upload named it; a dataset's image is never found (D8-I).
  if (upload.origin === 'dataset') await indexVersion(trx, version);
  await recordAssetEvent(trx, upload.spaceId, {
    kind: 'asset.ingested',
    subject: { kind: 'asset', id: version.artifactId, version: version.id },
  });
  return version;
}

/** An upload's end on the log (LIF-069; the AU1 plan, AU1-L), in the space it was made in. */
async function recordAssetEvent(
  trx: TenantTransaction,
  spaceId: string,
  event: Omit<AuditEvent, 'space'>,
): Promise<void> {
  const space = await trx
    .selectFrom('space')
    .select('name')
    .where('id', '=', spaceId)
    .executeTakeFirst();
  await recordEvent(
    trx,
    { ...event, space: spaceId },
    labels(labelled('space', space?.name, spaceId)),
  );
}

/**
 * Refuses an upload in the state named - at the door, `awaiting`; after its check, `checking` - saying
 * why. Undefined where it is no longer in that state, so a refusal never overwrites what another request
 * or another attempt has already moved it to. The caller removes its bytes.
 */
export async function refuseAssetUpload(
  trx: TenantTransaction,
  id: string,
  reason: AssetUploadReason,
  from: 'awaiting' | 'checking',
): Promise<StoredAssetUpload | undefined> {
  const row = await trx
    .updateTable('asset_upload')
    .set({ state: 'refused', reason, finished_at: new Date() })
    .where('id', '=', id)
    .where('state', '=', from)
    .returningAll()
    .executeTakeFirst();
  if (!row) return undefined;
  // Recorded, its reason by code; its bytes are the caller's to remove (AST-037).
  await recordAssetEvent(trx, row.space_id, {
    kind: 'asset.refused',
    outcome: 'refused',
    subject: { kind: 'asset_upload', id: row.id },
    detail: { reason },
  });
  return uploadOf(row);
}

/**
 * Whether anything but this upload still needs the object: an asset version naming it, or another
 * upload of the same bytes that is checking or ready. A key is the bytes' hash, so two uploads of one
 * image share it, and refusing one must not remove what the other stands on. Asked under
 * `holdObject`, so nothing can come to need it between the question and the removal.
 */
export async function objectInUse(
  trx: TenantTransaction,
  key: string,
  exceptUpload: string,
): Promise<boolean> {
  const version = await trx
    .selectFrom('artifact_version')
    .select('id')
    .where('kind', '=', 'asset')
    .where(sql<boolean>`content ->> 'object' = ${key}`)
    .limit(1)
    .executeTakeFirst();
  if (version) return true;
  // An image an import holds until it is accepted (0157), where this tenant stores them yet.
  const { rows: stored } = await sql<{ stored: boolean }>`
    select to_regclass(current_schema() || '.import_asset') is not null as stored`.execute(trx);
  if (stored[0]?.stored === true) {
    const { rows: held } =
      await sql`select 1 from import_asset where object_key = ${key} limit 1`.execute(trx);
    if (held.length > 0) return true;
  }
  // A translation job's returned file (0164), kept as what came back.
  const { rows: returns } = await sql<{ stored: boolean }>`
    select to_regclass(current_schema() || '.translation_job_return') is not null as stored`.execute(
    trx,
  );
  if (returns[0]?.stored === true) {
    const { rows: kept } =
      await sql`select 1 from translation_job_return where object_key = ${key} limit 1`.execute(
        trx,
      );
    if (kept.length > 0) return true;
  }
  // A package a delivery from CT Studio waits on (0172), until the delivery is written or refused.
  const { rows: deliveries } = await sql<{ stored: boolean }>`
    select to_regclass(current_schema() || '.bridge_delivery') is not null as stored`.execute(trx);
  if (deliveries[0]?.stored === true) {
    const { rows: waiting } =
      await sql`select 1 from bridge_delivery where package_key = ${key} limit 1`.execute(trx);
    if (waiting.length > 0) return true;
    // An SVG's original a written delivery kept by its hash, beside the PNG made of it (Ruling 27).
    const { rows: kept } = await sql`select 1 from bridge_delivery
       where provenance -> 'originals' @> jsonb_build_array(jsonb_build_object('key', ${key}::text))
       limit 1`.execute(trx);
    if (kept.length > 0) return true;
  }
  const upload = await trx
    .selectFrom('asset_upload')
    .select('id')
    .where('object_key', '=', key)
    .where('id', '<>', exceptUpload)
    .where('state', 'in', ['checking', 'ready'])
    .limit(1)
    .executeTakeFirst();
  return upload !== undefined;
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

/** One change to an image's rights (AST-031): what they became, by whom and when. */
export interface StoredAssetRights {
  readonly id: string;
  readonly rights: AssetRights;
  readonly recordedBy: string;
  readonly recordedAt: Date;
}

/** Every change to an asset's rights, newest first; the first is current (AL-C). */
export async function readAssetRights(
  trx: TenantTransaction,
  assetId: string,
): Promise<StoredAssetRights[]> {
  const rows = await trx
    .selectFrom('asset_rights')
    .select(['id', 'rights', 'recorded_by', 'recorded_at'])
    .where('asset_id', '=', assetId)
    .orderBy('recorded_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    rights: assetRightsSchema.parse(row.rights),
    recordedBy: row.recorded_by,
    recordedAt: row.recorded_at,
  }));
}

/** Each asset's current rights, by asset; one with none (short of 0180) is absent. */
export async function currentAssetRights(
  trx: TenantTransaction,
  assetIds: readonly string[],
): Promise<Map<string, { readonly id: string; readonly rights: AssetRights }>> {
  if (assetIds.length === 0) return new Map();
  const rows = await trx
    .selectFrom('asset_rights')
    .distinctOn('asset_id')
    .select(['asset_id', 'id', 'rights'])
    .where('asset_id', 'in', [...new Set(assetIds)])
    .orderBy('asset_id')
    .orderBy('recorded_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  return new Map(
    rows.map((row) => [row.asset_id, { id: row.id, rights: assetRightsSchema.parse(row.rights) }]),
  );
}

/**
 * An image's rights changed (AL-C), as a row of its own; the caller decided `edit` on the asset. A
 * declared licence must be a licence of this environment; a dataset's kind is never a person's to
 * record.
 */
export async function recordAssetRights(
  trx: TenantTransaction,
  input: { readonly assetId: string; readonly rights: AssetRights; readonly by: string },
): Promise<
  | { readonly answer: 'recorded'; readonly id: string }
  | { readonly answer: 'licence.missing' }
  | { readonly answer: 'rights.invalid' }
> {
  const parsed = assetRightsSchema.safeParse(input.rights);
  if (!parsed.success || parsed.data.kind === 'dataset') return { answer: 'rights.invalid' };
  const rights = parsed.data;
  if (rights.kind === 'declared') {
    const licence = await trx
      .selectFrom('artifact')
      .select('id')
      .where('id', '=', rights.licence)
      .where('kind', '=', 'licence')
      .executeTakeFirst();
    if (!licence) return { answer: 'licence.missing' };
  }
  const row = await trx
    .insertInto('asset_rights')
    .values({ asset_id: input.assetId, rights: JSON.stringify(rights), recorded_by: input.by })
    .returning('id')
    .executeTakeFirstOrThrow();
  const asset = await trx
    .selectFrom('artifact')
    .select('space_id')
    .where('id', '=', input.assetId)
    .executeTakeFirstOrThrow();
  await recordAssetEvent(trx, asset.space_id!, {
    kind: 'asset.relicensed',
    subject: { kind: 'asset', id: input.assetId },
  });
  return { answer: 'recorded', id: row.id };
}

export interface ImagesPolicy {
  readonly undeclared: 'warn' | 'refuse';
}

/** The environment's policy for an undeclared or lapsed image at publish (AST-053; AL-F). */
export async function imagesPolicy(trx: TenantTransaction): Promise<ImagesPolicy> {
  const row = await trx.selectFrom('images_policy').select('undeclared').executeTakeFirst();
  return { undeclared: row?.undeclared ?? 'warn' };
}

/** The policy set whole; the caller decided `administer` at the tenant. */
export async function setImagesPolicy(
  trx: TenantTransaction,
  policy: ImagesPolicy,
): Promise<ImagesPolicy> {
  await trx.updateTable('images_policy').set({ undeclared: policy.undeclared }).execute();
  return imagesPolicy(trx);
}
