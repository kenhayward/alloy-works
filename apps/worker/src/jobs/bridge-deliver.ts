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

/** A refusal found inside a transaction, thrown to roll everything it wrote back. */
class Refused extends Error {
  constructor(readonly error: BridgeError) {
    super(error.code);
  }
}

const SYSTEM: AuditContext = { actorKind: 'system' };
/** The fixed message of anything unexpected: never a cause, which could carry a credential or SQL. */
const UNEXPECTED = 'The delivery failed unexpectedly.';
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
async function imagesOf(
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
    let bytes: Buffer = sent;
    if ((meta?.contentType ?? image.contentType) === 'image/svg+xml') {
      const drawn = await rasterise(sent, meta?.widthMm ?? 0);
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
      alternative: meta?.alt ?? null,
    });
  }
  return { checked, originals };
}

/**
 * The identity the delivery's token resolves to now, held to what the request was (Ruling 17): the
 * token still there and unexpired and a service identity's, its grants in the space, masked by the
 * token's scopes, holding each permission asked; and the space live.
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
    .where('t.id', '=', delivery.tokenId)
    .where('t.expires_at', '>', new Date())
    .executeTakeFirst();
  if (token?.kind !== 'service') {
    return new Refused(
      bridgeError(
        'credential_rejected',
        'The token the delivery was asked with is no longer a live token of a service identity.',
      ),
    );
  }
  const identity: Identity = {
    tokenId: token.id,
    principalId: token.principal_id,
    name: token.display_name ?? 'Service identity',
    scopes: token.scopes.filter(isPermission),
  };
  await decideOnly(trx);
  const loaded = await loadFacts(trx, identity.principalId, {
    kind: 'space',
    id: delivery.spaceId,
  });
  const facts = loaded && { ...loaded, scopes: identity.scopes };
  if (!facts || !decide('read', facts).allowed) {
    return new Refused(bridgeError('not_found', 'The space is not there.'));
  }
  for (const permission of permissions) {
    if (!decide(permission, facts).allowed) {
      return new Refused(
        bridgeError(
          'credential_rejected',
          `The service identity may not ${permission} in this space.`,
          { permission },
        ),
      );
    }
  }
  try {
    await checkSpaceLive(trx, delivery.spaceId);
  } catch (error) {
    if (error instanceof SpaceArchived) {
      return new Refused(
        bridgeError('not_found', 'The space is archived: nothing new is made in it.'),
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

  /** The package let go, unless something else holds the same bytes. */
  const release = async (trx: TenantTransaction, store: TenantStore, key: string | null) => {
    const sha256 = key === null ? undefined : OBJECT_HASH.exec(key)?.[1];
    if (key === null || sha256 === undefined) return;
    await releaseObject(trx, { key, sha256 }, (each) => store.remove(each));
  };

  /** The delivery refused, its key freed and its package removed, then the job finished at once. */
  const refuse = async (
    tenant: Tenant,
    store: TenantStore,
    delivery: StoredDelivery,
    error: BridgeError,
    context: AuditContext,
  ): Promise<never> => {
    await db.withTenant(
      tenant,
      async (trx) => {
        if (await refuseDelivery(trx, delivery.id, error)) {
          await release(trx, store, delivery.packageKey);
        }
      },
      context,
    );
    throw new JobRefused(`bridge_${error.code}`, error.message);
  };

  /** The delivery written, with its receipt, what it carried along and what its provenance gains. */
  const finish = async (
    trx: TenantTransaction,
    store: TenantStore,
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
    await release(trx, store, delivery.packageKey);
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
        rejected('A document needs the provenance of its decomposition.', {
          reason: 'invalid_request',
        }),
        contextOf(identity),
      );
    }
    const images = await imagesOf(pkg, deps.decode);
    if ('code' in images) return refuse(tenant, store, delivery, images, contextOf(identity));
    const origin = (delivery.provenance as { origin?: unknown } | null)?.origin;
    const context = contextOf(identity);
    try {
      await db.withTenant(
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
          if (answer.answer === 'refused') throw new Refused(answer.error);
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
          await finish(
            trx,
            store,
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
        context,
      );
    } catch (error) {
      if (error instanceof Refused) return refuse(tenant, store, delivery, error.error, context);
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
    const context = contextOf(identity);
    const data = accepted.package.data;
    let receipt: Receipt = { written: [] };
    // Files or images alone are accepted and written as nothing (Ruling 24).
    if (data) {
      const provenance = accepted.package.provenance;
      if (!isExtractionProvenance(provenance)) {
        return refuse(
          tenant,
          store,
          delivery,
          rejected("A data package needs its extraction's provenance.", {
            reason: 'invalid_request',
          }),
          context,
        );
      }
      const schema = settings?.tableSchema ?? null;
      if (deps.delivered === undefined || schema === null || settings?.connectionId == null) {
        return refuse(tenant, store, delivery, notConfigured(), context);
      }
      const plans = bridge.planTables(data, provenance, accepted.destination['tableSet']);
      if ('refused' in plans) {
        const details =
          plans.refused === 'name_conflict'
            ? { reason: 'name_conflict', field: 'tableSet', detail: plans.detail }
            : { reason: 'reserved_column', detail: plans.detail };
        return refuse(tenant, store, delivery, rejected(plans.detail, details), context);
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
        return refuse(tenant, store, delivery, rejected(message, { reason, ...where }), context);
      }
      receipt = {
        written: written.written.map((id) => ({ kind: 'table', id, label: null, url: null })),
      };
    }
    await db.withTenant(tenant, (trx) => finish(trx, store, delivery, receipt, [], {}), context);
  };

  return {
    async run(tenant, job) {
      if (job.subjectId === null) return;
      const id = job.subjectId;
      const { delivery, store } = await db.withTenant(
        tenant,
        async (trx) => ({
          delivery: await readDelivery(trx, id),
          store: await deps.stores.forTenant(trx, tenant),
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
      if (first.identity instanceof Refused) {
        return refuse(tenant, store, delivery, first.identity.error, SYSTEM);
      }
      const identity = first.identity;
      const sha256 =
        delivery.packageKey === null ? undefined : OBJECT_HASH.exec(delivery.packageKey);
      if (delivery.packageKey === null || sha256 === null || sha256 === undefined) {
        return refuse(
          tenant,
          store,
          delivery,
          bridgeError('internal', UNEXPECTED),
          contextOf(identity),
        );
      }
      const bytes = await store.get(delivery.packageKey);
      if (createHash('sha256').update(bytes).digest('hex') !== sha256[1]) {
        // The store answered with other bytes than the key names: its fault, tried again.
        throw new Error('The stored package does not match its hash');
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
          bridgeError('internal', UNEXPECTED),
          contextOf(identity),
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
      await db.withTenant(
        tenant,
        async (trx) => {
          const delivery = await readDelivery(trx, id);
          if (delivery?.state !== 'running') return;
          const store = await deps.stores.forTenant(trx, tenant);
          if (await refuseDelivery(trx, id, bridgeError('internal', UNEXPECTED))) {
            await release(trx, store, delivery.packageKey);
          }
        },
        SYSTEM,
      );
    },
  };
}
