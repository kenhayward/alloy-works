import type {
  ComponentListQuery,
  ComponentParams,
  CreateComponentBody,
  SpaceParams,
} from '@alloy-works/api-contract';
import {
  createComponent,
  latestVersion,
  listComponentTypes,
  countReadableComponents,
  listReadableComponents,
  listSpacesFor,
  readLock,
  type LockState,
  type StoredVersion,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { decide } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { AppError } from './errors.js';
import type { SessionPrincipal } from './sessions.js';
import { wireCode } from './wire-codes.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PAGE = 50;

/** A lock as the API shows it: the session is told only to the principal it belongs to. */
export function lockView(lock: LockState, caller: string) {
  const yours = lock.holder === caller;
  return {
    holder: { id: lock.holder, name: lock.holderName },
    expectedRelease: lock.expiresAt.toISOString(),
    yours,
    session: yours ? lock.session : null,
  };
}

/** A version as the API names it: `revision.version`, its author, and when. */
export function versionView(version: StoredVersion) {
  return {
    id: version.id,
    number: `${version.revision}.${version.version}`,
    author: version.author,
    createdAt: version.createdAt.toISOString(),
    note: version.note,
  };
}

/** A listing's cursor is the last id it gave, spelled so nobody is tempted to read it as one. */
export function afterCursor(cursor: string | undefined): string | undefined {
  if (cursor === undefined) return undefined;
  const after = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!UUID.test(after)) {
    throw new AppError(400, 'invalid_request', 'The cursor is not one this listing gave out.');
  }
  return after;
}

/** The cursor a listing gives out for the id its next page starts after. */
export function cursorAfter(after: string | null): string | null {
  return after === null ? null : Buffer.from(after, 'utf8').toString('base64url');
}

/** A listing's page size: 50 unless the caller asked for 1 to 100. */
export function pageLimit(limit: string | undefined): number {
  return limit === undefined ? PAGE : Number(limit);
}

/**
 * The handlers that find and open components. Opening one is `read` on it, decided in the transaction
 * it is read in; the listing is filtered by the caller's readable set inside its query.
 */
export function componentHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
) {
  return {
    listSpaces: async (request: FastifyRequest) => {
      const items = await db.withTenant(tenantOf(request), (trx) =>
        listSpacesFor(trx, principalOf(request).principalId),
      );
      return { items: [...items] };
    },

    listComponentTypes: async (_request: FastifyRequest, { trx }: Authorised) => ({
      items: [...(await listComponentTypes(trx))],
    }),

    createComponent: async (request: FastifyRequest, { trx, principalId, facts }: Authorised) => {
      const { space } = request.params as SpaceParams;
      const body = request.body as CreateComponentBody;
      const answer = await createComponent(trx, {
        spaceId: space,
        title: body.title,
        language: body.language,
        direction: body.direction,
        ...(body.componentType === undefined ? {} : { componentTypeId: body.componentType }),
        author: principalId,
      });
      // The space was decided on before this ran, so `space.missing` here means it went in the moment
      // between; answered as absent either way, never as a refusal that says it exists.
      if (answer.answer === 'space.missing') throw notFound();
      if (answer.answer === 'component_type.missing') {
        throw new AppError(
          409,
          wireCode('component_type.missing'),
          'There is no such component type in this environment.',
        );
      }
      if (answer.answer === 'content.invalid') {
        throw new AppError(
          400,
          wireCode('content.invalid'),
          'A component needs a title and a language tag such as en-GB.',
        );
      }
      const { version } = answer;
      const held = await trx
        .selectFrom('space')
        .select(['id', 'name'])
        .where('id', '=', space)
        .executeTakeFirstOrThrow();
      return {
        id: version.artifactId,
        space: held,
        version: versionView(version),
        content: version.content as Record<string, unknown>,
        // Whoever created it may edit it: `create` and `edit` are separate permissions, so this is
        // the decision a write would take, not an assumption from having created the thing. Decided
        // against the space, because that is the target the route was authorised on - the component
        // did not exist when the facts were loaded, so a denial of `edit` on the component itself
        // cannot exist yet; nothing has had a chance to make one.
        mayEdit: decide('edit', facts).allowed,
        lock: null,
      };
    },

    listComponents: async (request: FastifyRequest) => {
      const query = request.query as ComponentListQuery;
      const after = afterCursor(query.cursor);
      const principal = principalOf(request).principalId;
      const spaces = query.spaces?.split(',');
      const [page, counts] = await db.withTenant(tenantOf(request), async (trx) => [
        await listReadableComponents(
          trx,
          principal,
          { ...(after === undefined ? {} : { after }), limit: pageLimit(query.limit) },
          spaces === undefined ? {} : { spaces },
        ),
        await countReadableComponents(trx, principal),
      ]);
      if (!page || !counts) throw new Error('A signed-in principal is not in its own tenant');
      const counted =
        spaces === undefined ? counts : counts.filter((one) => spaces.includes(one.id));
      return {
        items: page.items.map((item) => ({
          id: item.id,
          title: item.title,
          space: item.space,
          version: `${item.revision}.${item.version}`,
          type: item.type,
          language: item.language,
          changedAt: item.changedAt.toISOString(),
          changedBy: item.changedBy,
        })),
        next: cursorAfter(page.after),
        total: counted.reduce((sum, one) => sum + one.count, 0),
        spaces: counts.map((one) => ({ id: one.id, name: one.name, count: one.count })),
      };
    },

    getComponent: async (request: FastifyRequest, { trx, principalId, facts }: Authorised) => {
      const { id } = request.params as ComponentParams;
      const version = await latestVersion(trx, id);
      if (!version || version.kind !== 'component') throw notFound();
      const space = await trx
        .selectFrom('artifact as a')
        .innerJoin('space as s', 's.id', 'a.space_id')
        .select(['s.id', 's.name'])
        .where('a.id', '=', id)
        .executeTakeFirstOrThrow();
      const lock = await readLock(trx, id);
      return {
        id,
        space,
        version: versionView(version),
        content: version.content as Record<string, unknown>,
        // What the renderer offers from: the same decision a write would be refused by.
        mayEdit: decide('edit', facts).allowed,
        lock: lock ? lockView(lock, principalId) : null,
      };
    },
  };
}
