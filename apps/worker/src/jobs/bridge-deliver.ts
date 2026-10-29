import { createHash } from 'node:crypto';
import {
  checkSpaceLive,
  decideOnly,
  finishDelivery,
  holdObject,
  loadFacts,
  readBridgeSettings,
  readDelivery,
  refuseDelivery,
  releaseObject,
  SpaceArchived,
  writeDocumentDelivery,
  deliveryNote,
  type BridgeSettings,
  type CheckedImage,
  type DeliveredStore,
  type StoredDelivery,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import {
  ASSET_MAX_PIXELS,
  bridge,
  decide,
  isPermission,
  type AuditContext,
  type Permission,
} from '@alloy-works/domain';
import type { ObjectStores, TenantStore } from '@alloy-works/objects';
import {
  bridgeError,
  isExtractionProvenance,
  isDecompositionProvenance,
  SinkDeliverRequestSchema,
  type BridgeError,
  type BridgePackage,
  type Receipt,
} from '@kenhayward/bridge-contract';
import sharp from 'sharp';
import { JobRefused } from '../refusal.js';
import type { JobHandler } from '../worker.js';
import { checkImage, type Decode } from './ingest.js';

/** What `POST /bridge/deliveries` stores for the job: the request without its instance or credential. */
const AcceptedSchema = SinkDeliverRequestSchema.omit({ instanceId: true, credential: true });
type Accepted = ReturnType<typeof AcceptedSchema.parse>;

/** The service identity a delivery's recorded token resolves to now, its scopes masking its grants. */
interface Identity {
  readonly tokenId: string;
  readonly principalId: string;
  readonly name: string;
  readonly scopes: readonly Permission[];
}

/** An SVG's original, kept by its hash beside the PNG made of it (docs/design/ct-studio-sink.md, "Images"). */
interface Original {
  readonly image: string;
  readonly bytes: Buffer;
  readonly sha256: string;
}

/**
 * A refusal, thrown inside a transaction to roll everything it wrote back, and `as` the identity it is
 * audited as where the delivery's token still names one; the system only where it does not.
 */
class Refused extends Error {
  constructor(
    readonly error: BridgeError,
    readonly as?: Identity,
  ) {
    super(error.code);
  }
}

/** The object store failed, whatever went wrong there: retryable, `sink_unavailable` at the last. */
class StoreUnavailable extends Error {
  constructor(cause: unknown) {
    super('The object store failed', { cause });
  }
}

/** The tenant's store with every failure of it marked as the store's. */
const marked = (store: TenantStore): TenantStore => {
  const reach =
    <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await call(...args);
      } catch (error) {
        throw new StoreUnavailable(error);
      }
    };
  return {
    put: reach(store.put.bind(store)),
    putFile: reach(store.putFile.bind(store)),
    get: reach(store.get.bind(store)),
    remove: reach(store.remove.bind(store)),
    signedLink: reach(store.signedLink.bind(store)),
  };
};

/**
 * Whether a last failure was the store's or a database's (the platform's or the delivery store's) being
 * out of reach: a connection refused, reset or timed out, Postgres's connection exceptions (class 08),
 * or its shutting down (57P01 to 57P03). The design answers these `sink_unavailable`.
 */
function unavailable(error: unknown): boolean {
  if (error instanceof StoreUnavailable) return true;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return false;
  return (
    ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN'].includes(code) ||
    /^08[0-9A-Z]{3}$/.test(code) ||
    /^57P0[1-3]$/.test(code)
  );
}

const SYSTEM: AuditContext = { actorKind: 'system' };
/** The fixed message of anything unexpected: never a cause, which could carry a credential or SQL. */
const UNEXPECTED = 'The delivery failed unexpectedly.';
const UNAVAILABLE = 'Alloy Works cannot take this now; try again.';
const DPI = 300;
const MM_PER_INCH = 25.4;
const OBJECT_HASH = /\/sha256\/([0-9a-f]{64})$/;
const ORIGIN = /^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/;

/** The job acts as the identity, by the token the delivery was asked with. */
const contextOf = (identity: Identity): AuditContext => {
  const actorLabel = identity.name.trim().slice(0, 400);
  return {
    actorKind: 'token',
    actor: identity.principalId,
    token: identity.tokenId,
    ...(actorLabel === '' ? {} : { actorLabel }),
  };
};

const rejected = (message: string, details: Record<string, unknown>) =>
  bridgeError('content_rejected', message, details);
const notConfigured = () =>
  rejected('The space is not set up for data delivery.', { reason: 'not_configured' });

/**
 * The SVG drawn as a PNG at 300 dpi for the width CT Studio gives it: the density is chosen so the
 * drawing comes out at that width, and the PNG says 300 dpi. Undefined when sharp cannot draw it.
 */
export async function rasterise(svg: Buffer, widthMm: number): Promise<Buffer | undefined> {
  const width = Math.max(1, Math.round((widthMm / MM_PER_INCH) * DPI));
  const options = { limitInputPixels: ASSET_MAX_PIXELS, failOn: 'error' } as const;
  try {
    const intrinsic = (await sharp(svg, options).metadata()).width;
    // sharp reads an SVG at 72 dpi unless told otherwise, and takes densities of 1 to 100000.
    const density = Math.min(100_000, Math.max(1, (72 * width) / (intrinsic ?? width)));
    return await sharp(svg, { ...options, density })
      .resize({ width })
      .withMetadata({ density: DPI })
      .png()
      .toBuffer();
  } catch {
    return undefined;
  }
}

/**
 * Each of the package's images read whole, as an upload's are (`checkImage`): an SVG first drawn as a
 * PNG, its original kept. The first image refused refuses the delivery, naming it, before anything
 * is written.
 */
export async function imagesOf(
  pkg: BridgePackage,
  decode: Decode | undefined,
): Promise<{ checked: CheckedImage[]; originals: Original[] } | BridgeError> {
  const described = new Map((pkg.document?.images ?? []).map((image) => [image.id, image]));
  const checked: CheckedImage[] = [];
  const originals: Original[] = [];
  for (const image of pkg.images ?? []) {
    const meta = described.get(image.id);
    const sent = Buffer.from(image.content, 'base64');
    const refused = (refusal: string) =>
      rejected(`The image ${image.id} cannot be taken.`, {
        reason: 'image_refused',
        image: image.id,
        refusal,
      });
    // An image the document does not describe has no width to be drawn at, nor alternative text.
    if (meta === undefined) return refused('undescribed');
    let bytes: Buffer = sent;
    if (meta.contentType === 'image/svg+xml' || image.contentType === 'image/svg+xml') {
      const drawn = await rasterise(sent, meta.widthMm);
      if (drawn === undefined) return refused('undecodable');
      bytes = drawn;
      originals.push({
        image: image.id,
        bytes: sent,
        sha256: createHash('sha256').update(sent).digest('hex'),
      });
    }
    const check = await checkImage(bytes, decode);
    if (!check.ok) return refused(check.refusal);
    checked.push({
      id: image.id,
      bytes: new Uint8Array(bytes),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      header: check.header,
      alternative: meta.alt ?? null,
    });
  }
  return { checked, originals };
}

/**
 * The identity the delivery's token resolves to now, held to what the request was (Ruling 17): the
 * token still there and unexpired and a service identity's, its grants in the space, masked by the
 * token's scopes, holding each permission asked; and the space live. A refusal names the identity
 * where the token's row still does, expired or not, so it is audited as that identity.
 */
async function admitted(
  trx: TenantTransaction,
  delivery: StoredDelivery,
  permissions: readonly ('create' | 'edit')[],
): Promise<Identity | Refused> {
  const token = await trx
    .selectFrom('api_token as t')
    .innerJoin('principal as p', 'p.id', 't.principal_id')
    .select(['t.id', 't.scopes', 'p.id as principal_id', 'p.kind', 'p.display_name'])
    .select('t.expires_at')
    .where('t.id', '=', delivery.tokenId)
    .executeTakeFirst();
  const gone = bridgeError(
    'credential_rejected',
    'The token the delivery was asked with is no longer a live token of a service identity.',
  );
  if (token?.kind !== 'service') return new Refused(gone);
  const identity: Identity = {
    tokenId: token.id,
    principalId: token.principal_id,
    name: token.display_name ?? 'Service identity',
    scopes: token.scopes.filter(isPermission),
  };
  if (token.expires_at <= new Date()) return new Refused(gone, identity);
  await decideOnly(trx);
  const loaded = await loadFacts(trx, identity.principalId, {
    kind: 'space',
    id: delivery.spaceId,
  });
  const facts = loaded && { ...loaded, scopes: identity.scopes };
  if (!facts || !decide('read', facts).allowed) {
    return new Refused(bridgeError('not_found', 'The space is not there.'), identity);
  }
  for (const permission of permissions) {
    if (!decide(permission, facts).allowed) {
      return new Refused(
        bridgeError(
          'credential_rejected',
          `The service identity may not ${permission} in this space.`,
          { permission },
        ),
        identity,
      );
    }
  }
  try {
    await checkSpaceLive(trx, delivery.spaceId);
  } catch (error) {
    if (error instanceof SpaceArchived) {
      return new Refused(
        bridgeError('not_found', 'The space is archived: nothing new is made in it.'),
        identity,
      );
    }
    throw error;
  }
  return identity;
}

/** The title a delivered document takes: the destination's `documentName`, else its source file's stem. */
function titleOf(accepted: Accepted, sourceFilename: string): string {
  const named = accepted.destination['documentName']?.trim();
  if (named) return named;
  const stem = sourceFilename.replace(/\.[^./\\]*$/, '').trim();
  return stem === '' ? sourceFilename.trim() || 'Delivered document' : stem;
}

/**
 * **The `bridge_deliver` job** (docs/design/ct-studio-sink.md, "Where it lives" to "Idempotency and
 * atomicity", "Data tables"; the CS plan, Task 10): a delivery CT Studio's bridge asked for, written
 * end to end. The package is read back from the store and held to its hash, the identity checked again
 * as the request was, the images read whole, then everything - a document, its components and assets,
 * or a data package's tables - written, and the delivery finished with its receipt or refused. A
 * refusal is the package's own and finishes the job at once; anything else is tried again, and the
 * last attempt failing refuses the delivery as `internal`. The package is removed either way.
 */
export function bridgeDeliverJob(deps: {
  readonly db: TenantDatabase;
  readonly stores: ObjectStores;
  /** The delivery store (`SECRET_DELIVERED_URL`); without it a data package is refused `not_configured`. */
  readonly delivered?: DeliveredStore;
  readonly decode?: Decode;
}): JobHandler {
  const { db } = deps;

  /**
   * Whether the package may go, asked inside the transaction that finishes the delivery: the key to
   * remove once that transaction has committed, or null where something else holds the same bytes.
   * Removed only after the commit, so a commit that fails leaves the package for the retry.
   */
  const releasable = async (trx: TenantTransaction, key: string | null) => {
    const sha256 = key === null ? undefined : OBJECT_HASH.exec(key)?.[1];
    if (key === null || sha256 === undefined) return null;
    let removable: string | null = null;
    await releaseObject(trx, { key, sha256 }, (each) => {
      removable = each;
      return Promise.resolve();
    });
    return removable;
  };
  const remove = async (store: TenantStore, key: string | null) => {
    if (key !== null) await store.remove(key);
  };

  /**
   * The delivery refused, its key freed and its package removed, then the job finished at once;
   * audited as the identity the refusal names, else as the system.
   */
  const refuse = async (
    tenant: Tenant,
    store: TenantStore,
    delivery: StoredDelivery,
    refusal: Refused,
  ): Promise<never> => {
    const { error } = refusal;
    const removable = await db.withTenant(
      tenant,
      async (trx) =>
        (await refuseDelivery(trx, delivery.id, error))
          ? releasable(trx, delivery.packageKey)
          : null,
      refusal.as === undefined ? SYSTEM : contextOf(refusal.as),
    );
    await remove(store, removable);
    throw new JobRefused(`bridge_${error.code}`, error.message);
  };

  /**
   * The delivery written, with its receipt, what it carried along and what its provenance gains;
   * answers the package's key to remove once committed.
   */
  const finish = async (
    trx: TenantTransaction,
    delivery: StoredDelivery,
    receipt: Receipt,
    carried: readonly unknown[],
    provenance: Record<string, unknown>,
    options: { readonly persistentId?: string; readonly subject?: string } = {},
  ) => {
    const finished = await finishDelivery(trx, delivery.id, receipt, carried, {
      ...options,
      ...(Object.keys(provenance).length === 0 ? {} : { provenance }),
    });
    if (!finished) {
      throw new Error(`Delivery ${delivery.id} was finished by another attempt`);
    }
    return releasable(trx, delivery.packageKey);
  };

  /** A document delivery: its images read, then everything written in one transaction (API-067). */
  const deliverDocument = async (
    tenant: Tenant,
    store: TenantStore,
    delivery: StoredDelivery,
    accepted: Accepted,
    identity: Identity,
  ) => {
    const pkg = accepted.package;
    const provenance = pkg.provenance;
    if (!pkg.document || !isDecompositionProvenance(provenance)) {
      return refuse(
        tenant,
        store,
        delivery,
        new Refused(
          rejected('A document needs the provenance of its decomposition.', {
            reason: 'invalid_request',
          }),
          identity,
        ),
      );
    }
    const images = await imagesOf(pkg, deps.decode);
    if ('code' in images) return refuse(tenant, store, delivery, new Refused(images, identity));
    const origin = (delivery.provenance as { origin?: unknown } | null)?.origin;
    try {
      const removable = await db.withTenant(
        tenant,
        async (trx) => {
          const now = await admitted(
            trx,
            delivery,
            accepted.update === undefined ? ['create'] : ['create', 'edit'],
          );
          if (now instanceof Refused) throw now;
          const settings: BridgeSettings | undefined = await readBridgeSettings(
            trx,
            delivery.spaceId,
          );
          if (settings === undefined) {
            throw new Refused(
              rejected('The space is not set up for delivery.', { reason: 'not_configured' }),
              now,
            );
          }
          const answer = await writeDocumentDelivery(trx, {
            deliveryId: delivery.id,
            spaceId: delivery.spaceId,
            author: now.principalId,
            note: deliveryNote({
              sourceFilename: provenance.sourceFilename,
              decomposerVersion: provenance.decomposerVersion,
              actingUser: accepted.actingUser?.name ?? provenance.startedBy.name,
            }),
            document: pkg.document!,
            title: titleOf(accepted, provenance.sourceFilename),
            images: images.checked,
            ...(accepted.update === undefined ? {} : { update: accepted.update }),
            settings,
            store,
            ...(typeof origin === 'string' && ORIGIN.test(origin) ? { origin } : {}),
          });
          if (answer.answer === 'refused') throw new Refused(answer.error, now);
          // Kept by their hash, so a later decision to take SVG as an asset can recover them.
          const originals = [];
          for (const original of images.originals) {
            await holdObject(trx, original.sha256);
            const kept = await store.put(original.bytes, 'image/svg+xml');
            originals.push({
              image: original.image,
              key: kept.key,
              sha256: kept.sha256,
              contentType: 'image/svg+xml',
            });
          }
          // A property with nowhere to go is kept with the provenance, never dropped (Ruling 15).
          const unmapped = new Set(
            answer.carried
              .filter((entry) => entry.code === 'property_unmapped')
              .map((entry) => entry.element),
          );
          const persistentId = answer.receipt.document!.persistentId;
          return finish(
            trx,
            delivery,
            answer.receipt,
            answer.carried,
            {
              unmappedProperties: pkg.document!.properties.filter((property) =>
                unmapped.has(property.name),
              ),
              ...(originals.length === 0 ? {} : { originals }),
            },
            { persistentId, subject: persistentId },
          );
        },
        contextOf(identity),
      );
      await remove(store, removable);
    } catch (error) {
      if (error instanceof Refused) return refuse(tenant, store, delivery, error);
      throw error;
    }
  };

  /** A data package: its tables planned and written to the delivery store, then the delivery finished. */
  const deliverData = async (
    tenant: Tenant,
    store: TenantStore,
    delivery: StoredDelivery,
    accepted: Accepted,
    identity: Identity,
    settings: BridgeSettings | undefined,
  ) => {
    const refused = (error: BridgeError) =>
      refuse(tenant, store, delivery, new Refused(error, identity));
    // An update needs `edit` as well, as the route asked of it at accept.
    if (accepted.update !== undefined) {
      const now = await db.withTenant(
        tenant,
        (trx) => admitted(trx, delivery, ['create', 'edit']),
        SYSTEM,
      );
      if (now instanceof Refused) return refuse(tenant, store, delivery, now);
    }
    const data = accepted.package.data;
    let receipt: Receipt = { written: [] };
    // Files or images alone are accepted and written as nothing (Ruling 24).
    if (data) {
      const provenance = accepted.package.provenance;
      if (!isExtractionProvenance(provenance)) {
        return refused(
          rejected("A data package needs its extraction's provenance.", {
            reason: 'invalid_request',
          }),
        );
      }
      const schema = settings?.tableSchema ?? null;
      if (deps.delivered === undefined || schema === null || settings?.connectionId == null) {
        return refused(notConfigured());
      }
      const plans = bridge.planTables(data, provenance, accepted.destination['tableSet']);
      if ('refused' in plans) {
        const details =
          plans.refused === 'name_conflict'
            ? { reason: 'name_conflict', field: 'tableSet', detail: plans.detail }
            : { reason: 'reserved_column', detail: plans.detail };
        return refused(rejected(plans.detail, details));
      }
      const written = await deps.delivered.write(schema, plans, {
        sha256: provenance.sourceSha256,
        recipeId: provenance.recipeId,
      });
      if ('refused' in written) {
        // Named as the store names it: the table, the column and, for a value, its row (Ruling 20).
        const { refused: reason, ...where } = written;
        const message =
          written.refused === 'type_changed'
            ? `The column ${written.column} of ${written.table} has changed type.`
            : `Row ${written.row} of ${written.table} holds a value its column ${written.column} cannot.`;
        return refused(rejected(message, { reason, ...where }));
      }
      receipt = {
        written: written.written.map((id) => ({ kind: 'table', id, label: null, url: null })),
      };
    }
    const removable = await db.withTenant(
      tenant,
      (trx) => finish(trx, delivery, receipt, [], {}),
      contextOf(identity),
    );
    await remove(store, removable);
  };

  return {
    async run(tenant, job) {
      if (job.subjectId === null) return;
      const id = job.subjectId;
      const { delivery, store } = await db.withTenant(
        tenant,
        async (trx) => ({
          delivery: await readDelivery(trx, id),
          store: marked(await deps.stores.forTenant(trx, tenant)),
        }),
        SYSTEM,
      );
      // Nothing to do: another attempt already wrote or refused it.
      if (delivery?.state !== 'running') return;
      // Checked first, before the package is read: a token gone between accept and run refuses.
      const first = await db.withTenant(
        tenant,
        async (trx) => {
          const identity = await admitted(trx, delivery, ['create']);
          const settings = await readBridgeSettings(trx, delivery.spaceId);
          return { identity, settings };
        },
        SYSTEM,
      );
      if (first.identity instanceof Refused) return refuse(tenant, store, delivery, first.identity);
      const identity = first.identity;
      const sha256 =
        delivery.packageKey === null ? undefined : OBJECT_HASH.exec(delivery.packageKey);
      if (delivery.packageKey === null || sha256 === null || sha256 === undefined) {
        return refuse(
          tenant,
          store,
          delivery,
          new Refused(bridgeError('internal', UNEXPECTED), identity),
        );
      }
      const bytes = await store.get(delivery.packageKey);
      if (createHash('sha256').update(bytes).digest('hex') !== sha256[1]) {
        // The store answered with other bytes than the key names: its fault, tried again.
        throw new StoreUnavailable(new Error('The stored package does not match its hash'));
      }
      let json: unknown;
      try {
        json = JSON.parse(bytes.toString('utf8'));
      } catch {
        json = undefined;
      }
      const parsed = AcceptedSchema.safeParse(json);
      if (!parsed.success) {
        return refuse(
          tenant,
          store,
          delivery,
          new Refused(bridgeError('internal', UNEXPECTED), identity),
        );
      }
      if (delivery.family === 'document') {
        await deliverDocument(tenant, store, delivery, parsed.data, identity);
      } else {
        await deliverData(tenant, store, delivery, parsed.data, identity, first.settings);
      }
    },

    /** The last attempt failed for the store's or the database's reasons: never left running. */
    async failed(tenant, job, cause) {
      // Refused on its merits: already recorded as such.
      if (job.subjectId === null || cause instanceof JobRefused) return;
      const id = job.subjectId;
      const { store, removable } = await db.withTenant(
        tenant,
        async (trx) => {
          const store = await deps.stores.forTenant(trx, tenant);
          const delivery = await readDelivery(trx, id);
          if (delivery?.state !== 'running') return { store, removable: null };
          const refused = await refuseDelivery(
            trx,
            id,
            unavailable(cause)
              ? bridgeError('sink_unavailable', UNAVAILABLE)
              : bridgeError('internal', UNEXPECTED),
          );
          return { store, removable: refused ? await releasable(trx, delivery.packageKey) : null };
        },
        SYSTEM,
      );
      await remove(store, removable);
    },
  };
}
