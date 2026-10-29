import { createHash } from 'node:crypto';
import {
  enqueueJob,
  holdObject,
  readBridgeSettings,
  readDelivery,
  startDelivery,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import type { AuditContext, Permission } from '@alloy-works/domain';
import type { ObjectStores } from '@alloy-works/objects';
import {
  bridgeError,
  BridgeErrorSchema,
  type SinkDeliverRequest,
  type SinkDeliverResult,
  type SinkJobStatus,
} from '@kenhayward/bridge-contract';
import { authoriseAt } from '../access.js';
import { AppError } from '../errors.js';
import { refuse } from './errors.js';

/** The service identity a request's token resolved to: the token by its id, never its secret. */
export interface Identity {
  readonly tokenId: string;
  readonly principalId: string;
  readonly name: string;
  readonly scopes: readonly Permission[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The parts a package may carry that Alloy Works does not take (describe's `accepts`). */
const REFUSED_PARTS = ['rdf', 'narrative'] as const;

/** Who the delivery's transaction acts for: the identity, by its token, under the request's trace id. */
const contextOf = (identity: Identity, traceId: string): AuditContext => {
  const actorLabel = identity.name.trim().slice(0, 400);
  return {
    actorKind: 'token',
    actor: identity.principalId,
    token: identity.tokenId,
    traceId,
    ...(actorLabel === '' ? {} : { actorLabel }),
  };
};

/**
 * A permission the identity must hold at the space, masked by its token's scopes: a space it may not
 * read, or that is not there, is `not_found`; one it may read but not act in, `credential_rejected`,
 * since CT Studio then points its person at the connection.
 */
async function holds(
  trx: TenantTransaction,
  identity: Identity,
  permission: 'create' | 'edit',
  space: string,
): Promise<void> {
  try {
    await authoriseAt(
      trx,
      { principalId: identity.principalId, scopes: identity.scopes },
      permission,
      { kind: 'space', id: space },
    );
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    if (error.status === 404) throw refuse('not_found', 'The space is not there.');
    throw refuse(
      'credential_rejected',
      `The service identity may not ${permission} in this space.`,
      { permission },
    );
  }
}

/**
 * What the job is given to work from, stored in the tenant's object store by its SHA-256: the request
 * without its instance or its credential, so the token is never stored. The job holds only the
 * delivery's id (docs/design/ct-studio-sink.md, "Where it lives").
 */
const accepted = (request: SinkDeliverRequest) =>
  Buffer.from(
    JSON.stringify({
      destination: request.destination,
      idempotencyKey: request.idempotencyKey,
      actingUser: request.actingUser,
      ...(request.update === undefined ? {} : { update: request.update }),
      package: request.package,
    }),
    'utf8',
  );

/**
 * `POST /deliveries`: the destination checked, the package stored and the delivery started as a job,
 * answered `pending` with the delivery's id (API-068). A key already running answers that same
 * delivery; one already written answers its first receipt, and nothing is written again.
 */
export async function acceptDelivery(
  deps: { readonly db: TenantDatabase; readonly objects: ObjectStores },
  tenant: Tenant,
  identity: Identity,
  request: SinkDeliverRequest,
  traceId: string,
): Promise<SinkDeliverResult> {
  for (const part of REFUSED_PARTS) {
    if (request.package[part] != null) {
      throw refuse('unsupported_part', `Alloy Works does not take a package's ${part}.`, { part });
    }
  }
  const space = request.destination['space'];
  if (space === undefined || space === '') {
    throw refuse('content_rejected', 'The destination names no space.', {
      reason: 'invalid_request',
      issues: ['destination.space: required'],
    });
  }
  if (!UUID.test(space)) throw refuse('not_found', 'The space is not there.');
  const family = request.package.document ? 'document' : 'data';
  return deps.db.withTenant(
    tenant,
    async (trx) => {
      await holds(trx, identity, 'create', space);
      if (request.update !== undefined) await holds(trx, identity, 'edit', space);
      const known = await trx
        .selectFrom('bridge_delivery')
        .select(['id', 'state', 'receipt'])
        .where('key', '=', request.idempotencyKey)
        .executeTakeFirst();
      if (known?.state === 'written') {
        return { status: 'succeeded', receipt: known.receipt } as SinkDeliverResult;
      }
      if (known?.state === 'running') return { status: 'pending', sinkJobId: known.id };
      const settings = await readBridgeSettings(trx, space);
      if (settings === undefined || (family === 'data' && settings.tableSchema === null)) {
        throw refuse('content_rejected', 'The space is not set up for delivery.', {
          reason: 'not_configured',
        });
      }
      const bytes = accepted(request);
      // Held as the asset door holds its bytes, so no refusal elsewhere removes them in between.
      await holdObject(trx, createHash('sha256').update(bytes).digest('hex'));
      const store = await deps.objects.forTenant(trx, tenant);
      const stored = await store.put(bytes, 'application/json');
      const started = await startDelivery(trx, {
        key: request.idempotencyKey,
        spaceId: space,
        family,
        tokenId: identity.tokenId,
        packageKey: stored.key,
        provenance: {
          source: request.package.provenance,
          producer: request.package.producer,
          actingUser: request.actingUser,
        },
      });
      // Another request with the key got there first, after the look above: its answer is ours. The
      // bytes stored stay, by their hash, as the store keeps every object until it is released.
      if (started.answer === 'written') {
        return { status: 'succeeded', receipt: started.receipt } as SinkDeliverResult;
      }
      if (started.answer === 'started') await enqueueJob(trx, 'bridge_deliver', started.id);
      return { status: 'pending', sinkJobId: started.id };
    },
    contextOf(identity, traceId),
  );
}

/** `GET /deliveries/{id}`: the delivery as it stands; an id this tenant holds none of is `not_found`. */
export async function deliveryStatus(
  db: TenantDatabase,
  tenant: Tenant,
  id: string,
): Promise<SinkJobStatus> {
  const unknown = () => refuse('not_found', 'There is no delivery with this id.');
  if (!UUID.test(id)) throw unknown();
  const delivery = await db.withTenant(tenant, (trx) => readDelivery(trx, id));
  if (delivery === undefined) throw unknown();
  if (delivery.state === 'running') return { status: 'pending' };
  if (delivery.state === 'written') {
    return { status: 'succeeded', receipt: delivery.receipt } as SinkJobStatus;
  }
  const refusal = BridgeErrorSchema.safeParse(delivery.refusal);
  return {
    status: 'failed',
    error: refusal.success
      ? refusal.data
      : bridgeError('internal', 'The delivery failed unexpectedly.'),
  };
}
