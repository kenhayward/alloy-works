import type {
  CreateDefinitionBody,
  DefinitionParams,
  DefinitionVersionBody,
  DefinitionView,
  DefinitionListQuery,
} from '@alloy-works/api-contract';
import { cursorFor, pageAsked } from './listing.js';
import {
  createDefinition,
  listDefinitions,
  readDefinitionLatest,
  recordDefinitionVersion,
  type DefinitionAnswer,
  type StoredDefinition,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  componentTypeDefinitionSchema,
  fieldDefinitionSchema,
  metadataSchemaDefinitionSchema,
} from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { versionView } from './components.js';
import { AppError } from './errors.js';
import type { SessionPrincipal } from './sessions.js';
import { refused } from './wire-codes.js';

const PLACEHOLDER = '00000000-0000-4000-8000-000000000000';
const parsers = {
  field: fieldDefinitionSchema,
  metadataSchema: metadataSchemaDefinitionSchema,
  componentType: componentTypeDefinitionSchema,
} as const;

function definitionView(stored: StoredDefinition): DefinitionView {
  return {
    id: stored.id,
    kind: stored.kind,
    version: versionView(stored.version),
    definition: stored.definition as unknown as Record<string, unknown>,
  };
}

/** Each check a definition failed, refused by its code with what it names (definitions.md). */
function refusedDefinition(answer: DefinitionAnswer): never {
  switch (answer.answer) {
    case 'definition.unresolved':
      throw refused(
        400,
        'definition.unresolved',
        'This definition names a field or a schema that is not there.',
        { missing: answer.missing, failures: answer.requires },
      );
    case 'definition.invalid':
      throw refused(
        400,
        'definition.invalid',
        'A default this schema gives is not valid for its field.',
        {
          failures: answer.failures,
        },
      );
    case 'definition.name_taken':
      throw refused(
        400,
        'definition.name_taken',
        `Another definition of this kind is already called ${answer.holder.name}.`,
        { holder: answer.holder },
      );
    case 'assignment.conflict':
      throw refused(
        400,
        'assignment.conflict',
        'Two schemas this component type assigns give a field different defaults.',
        { failures: answer.failures },
      );
    case 'schema.conflict':
      throw refused(
        400,
        'schema.conflict',
        "This schema's default for a field would differ from another schema's where both are applied.",
        { conflicts: answer.conflicts },
      );
    case 'field.breaks_default':
      throw refused(
        400,
        'field.breaks_default',
        "This version of the field would make a schema's default for it invalid.",
        { broken: answer.broken },
      );
    case 'version.precondition':
      throw refused(
        409,
        'version.precondition',
        'This definition has a newer version than the one this page opened.',
        { current: definitionView(answer.current) },
      );
    case 'definition.missing':
      throw notFound();
    case 'created':
    case 'recorded':
    case 'version.unchanged':
      throw new Error(`A definition answered ${answer.answer} is not a refusal`);
  }
}

/** The definition routes (definitions.md, "Routes"). */
export function definitionHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  _principalOf: (request: FastifyRequest) => SessionPrincipal,
) {
  void db;
  void tenantOf;
  return {
    listDefinitions: async (request: FastifyRequest, { trx }: Authorised) => {
      const asked = pageAsked('definitions', request.query as DefinitionListQuery);
      const listed = await listDefinitions(trx, asked);
      return {
        next: cursorFor('definitions', asked.sort, asked.order, listed.snapshot, listed.next),
        items: listed.items.map((each) => ({
          id: each.id,
          kind: each.kind,
          name: each.name,
          version: {
            id: each.version.id,
            number: `${each.version.revision}.${each.version.version}`,
          },
        })),
      };
    },

    createDefinition: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const body = request.body as CreateDefinitionBody;
      const answer = await createDefinition(trx, {
        kind: body.kind,
        definition: body.definition,
        author: principalId,
      });
      if (answer.answer !== 'created') return refusedDefinition(answer);
      return definitionView(answer.definition);
    },

    // `authorise` never looks at an artifact's kind, so a component's id authorises cleanly here;
    // `readDefinitionLatest` answers nothing for it, and neither does this.
    getDefinition: async (request: FastifyRequest, { trx }: Authorised) => {
      const { id } = request.params as DefinitionParams;
      const stored = await readDefinitionLatest(trx, id);
      if (!stored) throw notFound();
      return definitionView(stored);
    },

    recordDefinitionVersion: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as DefinitionParams;
      const body = request.body as DefinitionVersionBody;
      const current = await readDefinitionLatest(trx, id);
      if (!current) throw notFound();
      // The contract cannot know the kind; the payload is read against the definition's own here.
      if (
        'id' in body.definition ||
        !parsers[current.kind].safeParse({ ...body.definition, id: PLACEHOLDER }).success
      ) {
        throw new AppError(400, 'invalid_request', `This is not a definition of its kind.`);
      }
      const answer = await recordDefinitionVersion(trx, {
        id,
        openedFrom: body.openedFrom,
        definition: body.definition,
        author: principalId,
      });
      if (answer.answer === 'recorded' || answer.answer === 'version.unchanged') {
        return definitionView(answer.definition);
      }
      return refusedDefinition(answer);
    },
  };
}
