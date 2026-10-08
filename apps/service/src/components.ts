import type {
  ComponentListQuery,
  ComponentParams,
  ComponentQuery,
  CreateComponentBody,
  SpaceListQuery,
  SpaceParams,
  FieldView,
  PageQuery,
  PeopleQuery,
} from '@alloy-works/api-contract';
import {
  componentFieldsNow,
  createComponent,
  latestSequence,
  latestVersion,
  listPeople,
  listComponentTypes,
  listReadableComponents,
  listVersions,
  listSpacesFor,
  newestUncutIteration,
  readLock,
  type LockState,
  type StoredVersion,
  type TenantTransaction,
  type VersionHeading,
  type VersionPosition,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { decide, type EffectiveField } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, scopesOf, type Authorised } from './access.js';
import { AppError } from './errors.js';
import { cursorFor, pageAsked } from './listing.js';
import type { SessionPrincipal } from './sessions.js';
import { refused } from './wire-codes.js';

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
export function versionView(version: VersionHeading) {
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

/**
 * A cursor into an artifact's versions: the last version's number, spelled so nobody is tempted to
 * read it. It carries no snapshot, since the versions a walk has yet to read never change (versions.ts,
 * `listVersions`).
 */
export function versionCursor(position: VersionPosition | null): string | null {
  return position === null
    ? null
    : Buffer.from(JSON.stringify([position.revision, position.version]), 'utf8').toString(
        'base64url',
      );
}

/** Where a page of versions continues, from a cursor `versionCursor` gave out; 400 for any other. */
export function afterVersion(cursor: string | undefined): VersionPosition | undefined {
  if (cursor === undefined) return undefined;
  let read: unknown;
  try {
    read = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    read = undefined;
  }
  const whole = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2_147_483_647;
  if (!Array.isArray(read) || read.length !== 2 || !whole(read[0]) || !whole(read[1])) {
    throw new AppError(400, 'invalid_request', 'The cursor is not one this listing gave out.');
  }
  return { revision: read[0], version: read[1] };
}

/** A listing's page size: 50 unless the caller asked for 1 to 100. */
export function pageLimit(limit: string | undefined): number {
  return limit === undefined ? PAGE : Number(limit);
}

/**
 * The handlers that find and open components. Opening one is `read` on it, decided in the transaction
 * it is read in; the listing is filtered by the caller's readable set inside its query.
 */
/**
 * Each field as a view carries it (`FieldView`): what a form draws and validates it by, and which
 * schemas make it required or fixed - a component's, a document's and a section's alike.
 */
export function fieldViews(effective: readonly EffectiveField[]): FieldView[] {
  return effective.map((each) => ({
    id: each.field.id,
    name: each.field.name,
    dataType: each.field.dataType,
    multiplicity: each.field.multiplicity,
    ...('maxValues' in each.field && each.field.maxValues !== undefined
      ? { maxValues: each.field.maxValues }
      : {}),
    validation: { ...each.field.validation },
    required: each.required,
    requiredBy: [...each.requiredBy],
    fixed: each.fixed,
    fixedBy: [...each.fixedBy],
    ...(each.default === undefined ? {} : { default: each.default.value }),
  }));
}

/**
 * A component's type, the fields its next version is written against, the schemas that make them what
 * they are, and its latest version's values (definitions.md, "A component's"): read through the
 * component, as access.md reads a definition an artifact uses, with no decision of its own.
 */
async function metadataView(trx: TenantTransaction, version: StoredVersion) {
  const { definitions, effective } = await componentFieldsNow(trx, version);
  return {
    type: { id: definitions.type.definition.id, name: definitions.type.definition.name },
    fields: fieldViews(effective),
    schemas: definitions.schemas.map((each) => ({
      id: each.definition.id,
      name: each.definition.name,
    })),
    values: { ...version.values },
  };
}

export function componentHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
) {
  return {
    // Anybody signed in may see who may be named in a user field (definitions.md, DE-J).
    listPeople: async (request: FastifyRequest) => {
      const asked = pageAsked('people', request.query as PeopleQuery);
      const people = await db.withTenant(tenantOf(request), (trx) => listPeople(trx, asked));
      return {
        items: people.items.map((each) => ({ ...each })),
        next: cursorFor('people', asked.sort, asked.order, people.snapshot, people.next),
      };
    },

    listSpaces: async (request: FastifyRequest) => {
      const query = request.query as SpaceListQuery;
      const asked = pageAsked('spaces', query);
      const spaces = await db.withTenant(tenantOf(request), (trx) =>
        listSpacesFor(
          trx,
          principalOf(request).principalId,
          scopesOf(request),
          asked,
          query.archived === 'false' ? { archived: false } : {},
        ),
      );
      return {
        items: [...spaces.items],
        next: cursorFor('spaces', asked.sort, asked.order, spaces.snapshot, spaces.next),
      };
    },

    listComponentTypes: async (request: FastifyRequest, { trx }: Authorised) => {
      const asked = pageAsked('componentTypes', request.query as PageQuery);
      const types = await listComponentTypes(trx, asked);
      return {
        items: [...types.items],
        next: cursorFor('componentTypes', asked.sort, asked.order, types.snapshot, types.next),
      };
    },

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
        throw refused(
          409,
          'component_type.missing',
          'There is no such component type in this environment.',
        );
      }
      if (answer.answer === 'content.invalid') {
        throw refused(
          400,
          'content.invalid',
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
        // Nothing has been saved of a component made a moment ago.
        unsaved: null,
        sequence: null,
        ...(await metadataView(trx, version)),
      };
    },

    listComponents: async (request: FastifyRequest) => {
      const query = request.query as ComponentListQuery;
      const asked = pageAsked('components', query);
      const principal = principalOf(request).principalId;
      const spaces = query.spaces?.split(',');
      const types = query.types?.split(',');
      const page = await db.withTenant(tenantOf(request), (trx) =>
        listReadableComponents(trx, principal, asked, {
          ...(spaces === undefined ? {} : { spaces }),
          ...(types === undefined ? {} : { types }),
        }),
      );
      if (!page) throw new Error('A signed-in principal is not in its own tenant');
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
        next: cursorFor('components', asked.sort, asked.order, page.snapshot, page.next),
        total: page.total,
        // The space facet as the listing first answered it, kept beside `facets` (API-012).
        spaces: page.facets.spaces.map((one) => ({
          id: one.value,
          name: one.label,
          count: one.count,
        })),
        facets: {
          spaces: page.facets.spaces.map(
            (each: { value: string; label: string; count: number }) => ({ ...each }),
          ),
          types: page.facets.types.map((each: { value: string; label: string; count: number }) => ({
            ...each,
          })),
        },
      };
    },

    /**
     * A component's versions, newest first, to whoever may read it (document-view.md, "Versions"):
     * what the document view offers a reference to be pinned to. Anything else at this address - a
     * definition, a document - is answered as a component that is not there, as `getComponent` does.
     */
    listComponentVersions: async (request: FastifyRequest, { trx }: Authorised) => {
      const { id } = request.params as ComponentParams;
      const query = request.query as PageQuery;
      const after = afterVersion(query.cursor);
      const artifact = await trx
        .selectFrom('artifact')
        .select('kind')
        .where('id', '=', id)
        .executeTakeFirst();
      if (artifact?.kind !== 'component') throw notFound();
      const page = await listVersions(trx, id, {
        limit: pageLimit(query.limit),
        ...(after === undefined ? {} : { after }),
      });
      return {
        items: page.items.map((each) => ({
          id: each.id,
          number: `${each.revision}.${each.version}`,
          createdAt: each.createdAt.toISOString(),
          author: each.author,
          note: each.note,
        })),
        next: versionCursor(page.next),
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
      // The caller's own, and only its time (RC-F): what a closed tab left that was never made a
      // version, offered as Recover. What it holds is read only under the lock.
      const unsaved = await newestUncutIteration(trx, { artifactId: id, principalId });
      // The session a reload names, the caller's own: where its sequence stands, so the reload goes
      // on past what was saved rather than under it (component-editor.md, "Undo across a reload").
      const { session } = request.query as ComponentQuery;
      const sequence =
        session === undefined
          ? null
          : await latestSequence(trx, { artifactId: id, principal: principalId, session });
      return {
        id,
        space,
        version: versionView(version),
        content: version.content as Record<string, unknown>,
        // What the renderer offers from: the same decision a write would be refused by.
        mayEdit: decide('edit', facts).allowed,
        lock: lock ? lockView(lock, principalId) : null,
        unsaved: unsaved === null ? null : { savedAt: unsaved.toISOString() },
        sequence,
        ...(await metadataView(trx, version)),
      };
    },
  };
}
