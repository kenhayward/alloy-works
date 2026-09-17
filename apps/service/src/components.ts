import type { ComponentListQuery, ComponentParams } from '@alloy-works/api-contract';
import {
  latestVersion,
  listReadableComponents,
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
    listComponents: async (request: FastifyRequest) => {
      const query = request.query as ComponentListQuery;
      const after = afterCursor(query.cursor);
      const page = await db.withTenant(tenantOf(request), (trx) =>
        listReadableComponents(trx, principalOf(request).principalId, {
          ...(after === undefined ? {} : { after }),
          limit: pageLimit(query.limit),
        }),
      );
      if (!page) throw new Error('A signed-in principal is not in its own tenant');
      return {
        items: page.items.map((item) => ({
          id: item.id,
          title: item.title,
          space: item.space,
          version: `${item.revision}.${item.version}`,
        })),
        next: cursorAfter(page.after),
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
