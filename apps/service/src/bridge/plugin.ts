import {
  findApiToken,
  listSpacesFor,
  recordNonce,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import type { ObjectStores } from '@alloy-works/objects';
import {
  bridgeError,
  BrowseRequestSchema,
  ConnectionTestRequestSchema,
  SinkDeliverRequestSchema,
  type BrowseResult,
  type ConnectionTestResult,
} from '@kenhayward/bridge-contract';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';
import { cursorFor, pageAsked } from '../listing.js';
import { hashToken } from '../sessions.js';
import { bearerSecret } from '../tokens.js';
import { acceptDelivery, deliveryStatus, type Identity } from './deliveries.js';
import { describeSink } from './describe.js';
import { loggable, refuse, signatureRefused, toBridgeAnswer } from './errors.js';
import { checkSignature, signatureMissing } from './signing.js';

/** The most listing pages one browse reads looking for spaces the identity may create in. */
const BROWSE_PAGES = 20;

/** Where the bridge's routes live, and what their signed paths are relative to. */
const PREFIX = '/bridge';

/** The largest body taken: above CT Studio's 50 MiB, since a decomposed document carries its images. */
const BODY_LIMIT = 100 * 1024 * 1024;

export interface BridgeDeps {
  readonly db: TenantDatabase;
  readonly objects: ObjectStores;
  /** SECRET_BRIDGE_KEYS: any one of them may sign, so a key can be rotated. */
  readonly keys: readonly string[];
  readonly resolve: (hostname: string) => Promise<Tenant | undefined>;
}

/** What a signed request carries once its signature and nonce hold: its tenant and its JSON body. */
interface Admitted {
  readonly tenant: Tenant;
  readonly body: unknown;
}

/**
 * A schema of the contract's, by what `read` asks of it: the contract carries its own zod, so its
 * schemas are not this package's zod types.
 */
interface Reading<T> {
  safeParse(value: unknown):
    | { readonly success: true; readonly data: T }
    | {
        readonly success: false;
        readonly error: {
          readonly issues: readonly { readonly path: PropertyKey[]; readonly message: string }[];
        };
      };
}

/** A body read with the contract's schema; one it does not hold is the contract's refusal of content. */
function read<T>(schema: Reading<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  // Paths and the schema's words, never a value: a credential is part of the body.
  throw refuse('content_rejected', 'The request is not valid.', {
    reason: 'invalid_request',
    issues: parsed.error.issues
      .slice(0, 20)
      .map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`),
  });
}

/** The tenant's slug and name, as describe's one instance and connections:test name it. */
async function instanceOf(db: TenantDatabase, tenant: Tenant) {
  const profile = await db.withTenant(tenant, (trx) =>
    trx.selectFrom('profile').select('display_name').executeTakeFirst(),
  );
  return { id: tenant.id, label: profile?.display_name ?? tenant.id };
}

/** The one instance this hostname serves: its tenant's slug, or `instance_not_allowed`. */
function checkInstance(tenant: Tenant, instanceId: string | null): void {
  if (instanceId !== tenant.id) {
    throw refuse('instance_not_allowed', 'This address serves no such instance.');
  }
}

/**
 * The credential's `token`, checked on every call: a live token of a service identity in this
 * tenant. A person's token, or one revoked, expired or unknown, is `credential_rejected`, in the same
 * words whichever it is. The token is used only for its hash, and goes no further.
 */
async function identityOf(
  db: TenantDatabase,
  tenant: Tenant,
  credential: Readonly<Record<string, string>> | null,
  traceId: string,
): Promise<Identity> {
  const token = credential?.['token'];
  if (token === undefined || token === '') {
    throw refuse('credential_missing', 'The connection holds no service identity token.');
  }
  const rejected = () =>
    refuse(
      'credential_rejected',
      'The token is not a live token of a service identity in this environment.',
    );
  const secret = bearerSecret(`Bearer ${token}`);
  if (secret === undefined) throw rejected();
  const identity = await db.withTenant(tenant, async (trx) => {
    const holder = await findApiToken(trx, hashToken(secret), new Date(), traceId);
    if (!holder) return undefined;
    const principal = await trx
      .selectFrom('principal')
      .select(['kind', 'display_name'])
      .where('id', '=', holder.principalId)
      .executeTakeFirst();
    if (principal?.kind !== 'service') return undefined;
    return {
      tokenId: holder.tokenId,
      principalId: holder.principalId,
      name: principal.display_name ?? 'Service identity',
      scopes: holder.scopes,
    };
  });
  if (!identity) throw rejected();
  return identity;
}

/**
 * CT Studio's delivery bridge contract, version 2, served under `/bridge` on a tenant's own hostname
 * (docs/design/ct-studio-sink.md, "Where it lives" and "The contract as served"; API-065). Not a
 * contract route of ours: its shapes, errors and signing are the bridge's, so it is a scope of its
 * own, with its own body parser, error handler and not-found handler, touching nothing of `/v1`.
 *
 * Every request is signed: its exact bytes are checked before anything is read, and only then its
 * tenant resolved, its nonce taken and its JSON parsed.
 */
export function registerBridge(app: FastifyInstance, deps: BridgeDeps): void {
  const { db } = deps;
  void app.register(
    async (scope) => {
      const admitted = new WeakMap<FastifyRequest, Admitted>();
      const admittedOf = (request: FastifyRequest) => {
        const found = admitted.get(request);
        if (!found) throw new Error('A bridge route ran without its admission');
        return found;
      };

      // Every body is read as bytes, whatever its type, so the signature covers what arrived.
      scope.removeAllContentTypeParsers();
      scope.addContentTypeParser(
        '*',
        { parseAs: 'buffer', bodyLimit: BODY_LIMIT },
        (_request, body, done) => done(null, body),
      );

      scope.setErrorHandler(async (error, request, reply) => {
        const { status, body, unexpected } = toBridgeAnswer(error);
        if (unexpected) request.log.error({ failure: loggable(error) }, 'a bridge request failed');
        return reply.status(status).send(body);
      });

      scope.setNotFoundHandler(async (_request, reply) =>
        reply.status(404).send(bridgeError('not_found', 'There is no such bridge route.')),
      );

      // Before any body is read: a request with no signature, or one out of its window, is refused
      // without its bytes being taken in. The signature itself is checked once they are.
      scope.addHook('onRequest', async (request) => {
        const reason = signatureMissing(request.headers);
        if (reason !== undefined) throw signatureRefused(reason);
      });

      // preValidation, once the bytes are in: nothing of a route runs before its signature holds.
      scope.addHook('preValidation', async (request) => {
        const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        const path = request.url.slice(PREFIX.length) || '/';
        const signed = checkSignature(deps.keys, {
          method: request.method,
          path,
          body: raw,
          headers: request.headers,
        });
        if (!signed.ok) throw signatureRefused(signed.reason);
        const tenant = await deps.resolve(request.hostname);
        if (!tenant)
          throw refuse('instance_not_allowed', 'No environment is served at this address.');
        // Taken in its own transaction, so a request refused later has still spent its nonce.
        const nonce = await db.withTenant(tenant, (trx) => recordNonce(trx, signed.nonce));
        if (nonce === 'replayed') throw signatureRefused('replayed');
        let body: unknown = undefined;
        if (raw.length > 0) {
          const type = String(request.headers['content-type'] ?? '')
            .split(';')[0]!
            .trim()
            .toLowerCase();
          if (type !== 'application/json') {
            throw refuse('content_rejected', 'The body must be application/json.', {
              reason: 'invalid_request',
            });
          }
          try {
            body = JSON.parse(raw.toString('utf8'));
          } catch {
            throw refuse('content_rejected', 'The body is not valid JSON.', {
              reason: 'invalid_request',
            });
          }
        }
        admitted.set(request, { tenant, body });
      });

      // Every answer, a refusal or the not-found one too: a receipt or an identity is no one's to cache.
      scope.addHook('onSend', async (_request, reply, payload) => {
        void reply.header('Cache-Control', 'no-store');
        return payload;
      });

      // The design's limit, on every route as on the parser, so it holds whichever of the two Fastify
      // reads a body's limit from.
      const limited = { bodyLimit: BODY_LIMIT };

      scope.get('/describe', limited, async (request) =>
        describeSink(await instanceOf(db, admittedOf(request).tenant)),
      );

      // `::` is a literal colon: the path is /connections:test.
      scope.post('/connections::test', limited, async (request): Promise<ConnectionTestResult> => {
        const { tenant, body } = admittedOf(request);
        const asked = read(ConnectionTestRequestSchema, body);
        checkInstance(tenant, asked.instanceId);
        const identity = await identityOf(db, tenant, asked.credential, request.id);
        const instance = await instanceOf(db, tenant);
        return { ok: true, identity: `${identity.name} on ${instance.label}` };
      });

      scope.post('/browse', limited, async (request): Promise<BrowseResult> => {
        const { tenant, body } = admittedOf(request);
        const asked = read(BrowseRequestSchema, body);
        checkInstance(tenant, asked.instanceId);
        const identity = await identityOf(db, tenant, asked.credential, request.id);
        if (asked.field !== 'space') {
          throw refuse('content_rejected', 'Only the space field is browsed.', {
            reason: 'invalid_request',
          });
        }
        // Spaces have no children.
        if (asked.parentId !== null) return { nodes: [], nextCursor: null };
        let page;
        try {
          page = pageAsked('spaces', asked.cursor === null ? {} : { cursor: asked.cursor });
        } catch (error) {
          if (error instanceof AppError) {
            throw refuse('content_rejected', 'The cursor is not one this browse gave out.', {
              reason: 'invalid_request',
            });
          }
          throw error;
        }
        // A space the identity may only read is no destination: browse offers those it may create in,
        // reading on until a page holds a page's worth or the spaces end, so no page comes back empty
        // while more remain.
        const { nodes, next } = await db.withTenant(tenant, async (trx) => {
          const found: BrowseResult['nodes'] = [];
          let asking = page;
          for (let pages = 1; ; pages += 1) {
            const listed = await listSpacesFor(trx, identity.principalId, identity.scopes, asking, {
              archived: false,
            });
            for (const space of listed.items) {
              if (!space.mayCreate) continue;
              found.push({
                id: space.id,
                label: space.name,
                kind: 'space',
                hasChildren: false,
                selectable: true,
              });
            }
            const after = cursorFor('spaces', page.sort, page.order, listed.snapshot, listed.next);
            if (listed.next === null || found.length >= page.limit || pages >= BROWSE_PAGES) {
              return { nodes: found, next: after };
            }
            asking = { ...asking, after: listed.next, snapshot: listed.snapshot };
          }
        });
        return { nodes, nextCursor: next };
      });

      scope.post('/deliveries', limited, async (request) => {
        const { tenant, body } = admittedOf(request);
        const asked = read(SinkDeliverRequestSchema, body);
        checkInstance(tenant, asked.instanceId);
        const identity = await identityOf(db, tenant, asked.credential, request.id);
        return acceptDelivery(
          deps,
          tenant,
          identity,
          asked,
          request.id,
          `https://${request.hostname}`,
        );
      });

      scope.get('/deliveries/:id', limited, async (request) => {
        const { tenant } = admittedOf(request);
        return deliveryStatus(db, tenant, (request.params as { id: string }).id);
      });
    },
    { prefix: PREFIX },
  );
}
