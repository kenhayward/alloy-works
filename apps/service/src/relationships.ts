import type {
  ChangeRelationshipBody,
  MakeRelationshipBody,
  NeighboursQuery,
  NeighboursView,
  PathQuery,
  PathView,
  RelationshipParams,
  RelationshipView,
} from '@alloy-works/api-contract';
import {
  changeRelationship,
  makeRelationship,
  neighbours,
  readRelationship,
  relationshipType,
  removeRelationship,
  shortestPath,
  type RelationshipAnswer,
  type StoredRelationship,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import type { RelationshipTypeDefinition } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { authoriseAt, callerOf, notFound, type Authorised } from './access.js';
import { AppError } from './errors.js';
import { refused } from './wire-codes.js';

export function relationshipView(relationship: StoredRelationship): RelationshipView {
  return {
    id: relationship.id,
    type: relationship.type,
    from: { ...relationship.from },
    to: { ...relationship.to },
    values: { ...relationship.values },
    createdBy: relationship.createdBy,
    createdAt: relationship.createdAt.toISOString(),
    changedAt: relationship.changedAt.toISOString(),
  };
}

/** The ends a caller acts on: read on both, and the permission the type asks at each (REL-035). */
async function mayRelate(
  trx: TenantTransaction,
  request: FastifyRequest,
  type: RelationshipTypeDefinition | undefined,
  ends: { readonly from: string; readonly to: string },
): Promise<void> {
  const caller = callerOf(request);
  for (const end of ['from', 'to'] as const) {
    const target = { kind: 'artifact' as const, id: ends[end] };
    await authoriseAt(trx, caller, 'read', target);
    const permission = type?.[end].permission ?? 'read';
    if (permission !== 'read') await authoriseAt(trx, caller, permission, target);
  }
}

/** A refusal in an error's shape (REL-008, REL-010, REL-012, REL-046). */
function refusedBy(answer: RelationshipAnswer): never {
  switch (answer.answer) {
    case 'made':
    case 'changed':
      throw new Error('A relationship made or changed is no refusal');
    case 'type.missing':
    case 'end.missing':
      throw notFound();
    case 'end.refused': {
      const { refusal } = answer;
      const words =
        refusal.refused === 'kind'
          ? `This type does not relate ${refusal.end === 'from' ? 'from' : 'to'} a ${refusal.kind}.`
          : refusal.refused === 'self'
            ? 'This type does not relate an artifact to itself.'
            : 'This type is deprecated: no new relationship may take it.';
      throw refused(400, 'relationship.refused', words, {
        reason: refusal.refused,
        ...(refusal.refused === 'kind' ? { end: refusal.end } : {}),
      });
    }
    case 'version.foreign':
      throw refused(400, 'relationship.refused', 'That version is not a version of that end.', {
        reason: 'version',
        end: answer.end,
      });
    case 'cardinality.full':
      throw refused(
        409,
        'relationship.cardinality',
        `The ${answer.end} end already holds the one relationship of this type it may.`,
        { end: answer.end },
      );
    case 'cycle':
      throw refused(
        409,
        'relationship.cycle',
        'This type is acyclic, and this would close a cycle.',
      );
    case 'values.invalid':
      throw refused(400, 'values.invalid', "Its values do not satisfy its type's fields.", {
        failures: answer.failures,
      });
  }
}

/** A field's value as asked, as text: JSON where it parses, so `true` and `3` are not strings. */
function valueOf(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Relationships through the API (REL-001, REL-011, REL-033 to REL-035; the R8 plan, R8-D, R8-E). */
export function relationshipHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
) {
  const held = async (trx: TenantTransaction, request: FastifyRequest) => {
    const { id } = request.params as RelationshipParams;
    const relationship = await readRelationship(trx, id);
    if (!relationship) throw notFound();
    return relationship;
  };
  return {
    makeRelationship: async (request: FastifyRequest): Promise<RelationshipView> => {
      const body = request.body as MakeRelationshipBody;
      return db.withTenant(tenantOf(request), async (trx) => {
        const type = await relationshipType(trx, body.type);
        if (!type) throw notFound();
        await mayRelate(trx, request, type, { from: body.from.artifact, to: body.to.artifact });
        const answer = await makeRelationship(trx, {
          by: callerOf(request).principalId,
          type: body.type,
          from: body.from,
          to: body.to,
          ...(body.values ? { values: body.values } : {}),
        });
        if (answer.answer !== 'made' && answer.answer !== 'changed') refusedBy(answer);
        return relationshipView(answer.relationship);
      });
    },

    getRelationship: async (request: FastifyRequest): Promise<RelationshipView> =>
      db.withTenant(tenantOf(request), async (trx) => {
        const relationship = await held(trx, request);
        await mayRelate(trx, request, undefined, {
          from: relationship.from.artifact,
          to: relationship.to.artifact,
        });
        return relationshipView(relationship);
      }),

    changeRelationship: async (request: FastifyRequest): Promise<RelationshipView> => {
      const body = request.body as ChangeRelationshipBody;
      return db.withTenant(tenantOf(request), async (trx) => {
        const relationship = await held(trx, request);
        const type = await relationshipType(trx, relationship.type);
        // The ends as they stand, and as they would be: the caller acts on both.
        await mayRelate(trx, request, type, {
          from: relationship.from.artifact,
          to: relationship.to.artifact,
        });
        await mayRelate(trx, request, type, {
          from: body.from?.artifact ?? relationship.from.artifact,
          to: body.to?.artifact ?? relationship.to.artifact,
        });
        const answer = await changeRelationship(trx, {
          id: relationship.id,
          ...(body.from ? { from: body.from } : {}),
          ...(body.to ? { to: body.to } : {}),
          ...(body.values ? { values: body.values } : {}),
        });
        if (answer.answer === 'missing') throw notFound();
        if (answer.answer !== 'made' && answer.answer !== 'changed') refusedBy(answer);
        return relationshipView(answer.relationship);
      });
    },

    getArtifactRelationships: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<NeighboursView> => {
      const { id } = request.params as RelationshipParams;
      const query = request.query as NeighboursQuery;
      if ((query.field === undefined) !== (query.value === undefined)) {
        throw new AppError(
          400,
          'invalid_request',
          'Name a field and a value together, or neither.',
        );
      }
      const found = await neighbours(trx, principalId, id, {
        ...(query.type ? { type: query.type } : {}),
        ...(query.direction ? { direction: query.direction } : {}),
        ...(query.field !== undefined && query.value !== undefined
          ? { field: { id: query.field, value: valueOf(query.value) } }
          : {}),
      });
      return {
        relationships: found.items.map((each) => ({
          relationship: relationshipView(each.relationship),
          direction: each.direction,
          other: { ...each.other },
        })),
        cut: found.cut,
        more: found.more,
      };
    },

    getArtifactPath: async (request: FastifyRequest, authorised: Authorised): Promise<PathView> => {
      const { trx, principalId } = authorised;
      const { id } = request.params as RelationshipParams;
      const query = request.query as PathQuery;
      await authoriseAt(trx, callerOf(request), 'read', { kind: 'artifact', id: query.to });
      const found = await shortestPath(
        trx,
        principalId,
        id,
        query.to,
        Number(query.depth),
        query.types ? query.types.split(',') : null,
      );
      return { path: found.path?.map((each) => ({ ...each })) ?? null, cut: found.cut };
    },

    removeRelationship: async (request: FastifyRequest): Promise<RelationshipView> =>
      db.withTenant(tenantOf(request), async (trx) => {
        const relationship = await held(trx, request);
        const type = await relationshipType(trx, relationship.type);
        await mayRelate(trx, request, type, {
          from: relationship.from.artifact,
          to: relationship.to.artifact,
        });
        await removeRelationship(trx, relationship.id);
        return relationshipView(relationship);
      }),
  };
}
