import { randomBytes } from 'node:crypto';
import {
  blockIdentifierFrom,
  carryForward,
  definitionsFor,
  readDefinition,
  resolveComponentFields,
  type ComponentTypeDefinition,
  type DefinitionKind,
  type DefinitionOf,
  type FieldDefinition,
  type MetadataSchemaDefinition,
  type Versioned,
} from '@alloy-works/domain';
import type { TenantTransaction } from './tables.js';
import { createArtifact, latestVersion, type StoredVersion } from './versions.js';

/**
 * The component type 0015 gives every environment: Topic, assigning no schemas (MET-012). Fixed, so a
 * development database made before 0015 keeps the one `pnpm dev:setup` has been making rather than
 * gaining a second beside it.
 */
export const STARTER_COMPONENT_TYPE_ID = '5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01';

/** The component type this environment declares as its default (MET-012). */
export async function defaultComponentType(trx: TenantTransaction): Promise<string | undefined> {
  const row = await trx
    .selectFrom('component_type_default')
    .select('component_type_id')
    .executeTakeFirst();
  return row?.component_type_id;
}

/** One component type as a chooser shows it. */
export interface ComponentTypeSummary {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
}

/**
 * Every component type this environment holds, by name, with the default marked - each read at its
 * latest version the way stored definitions are read, so a payload from an older definition schema is
 * migrated rather than refused. One that does not read is left out rather than throwing: a chooser is
 * better short than broken, and the definitions-management design owns telling somebody why.
 */
export async function listComponentTypes(
  trx: TenantTransaction,
): Promise<readonly ComponentTypeSummary[]> {
  const declared = await defaultComponentType(trx);
  const rows = await trx
    .selectFrom('artifact as a')
    .innerJoinLateral(
      (eb) =>
        eb
          .selectFrom('artifact_version as v')
          .select(['v.id', 'v.content'])
          .whereRef('v.artifact_id', '=', 'a.id')
          .orderBy('v.revision_no', 'desc')
          .orderBy('v.version_no', 'desc')
          .limit(1)
          .as('latest'),
      (join) => join.onTrue(),
    )
    .select(['a.id', 'latest.id as version_id', 'latest.content'])
    .where('a.kind', '=', 'componentType')
    .execute();
  const types = rows.flatMap((row): ComponentTypeSummary[] => {
    const read = readDefinition('componentType', row.content, {
      artifact: row.id,
      version: row.version_id,
    });
    if (!read.ok) return [];
    return [{ id: row.id, name: read.definition.name, isDefault: row.id === declared }];
  });
  return types.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * The latest version of a definition, read the way stored definitions are: migrated, then parsed.
 * Undefined when this environment holds no such artifact, or holds one of another kind - a caller's
 * identifier is refused politely, where a payload that does not read at all is a broken store and
 * throws.
 */
async function currentDefinition<K extends DefinitionKind>(
  trx: TenantTransaction,
  kind: K,
  id: string,
): Promise<Versioned<DefinitionOf[K]> | undefined> {
  const stored = await latestVersion(trx, id);
  if (!stored || stored.kind !== kind) return undefined;
  const read = readDefinition(kind, stored.content, { artifact: id, version: stored.id });
  if (!read.ok) throw new Error(`The ${kind} ${id} at ${stored.id} does not read: ${read.failure}`);
  return { version: stored.id, definition: read.definition };
}

/** A component type at its current version, with every schema it assigns and every field they group. */
export interface CurrentDefinitions {
  readonly type: Versioned<ComponentTypeDefinition>;
  readonly schemas: readonly Versioned<MetadataSchemaDefinition>[];
  readonly fields: readonly Versioned<FieldDefinition>[];
}

/**
 * What a component's next version is written against (MET-018), for creating and for cutting alike:
 * the type, each schema it assigns and each field those group, at their current versions. One
 * statement at a time, in the order they are named, because a transaction is one connection.
 * Undefined when this environment holds no such component type.
 */
export async function currentDefinitionsFor(
  trx: TenantTransaction,
  typeId: string,
): Promise<CurrentDefinitions | undefined> {
  const type = await currentDefinition(trx, 'componentType', typeId);
  if (!type) return undefined;
  const schemas: Versioned<MetadataSchemaDefinition>[] = [];
  for (const assignment of type.definition.assignments) {
    const schema = await currentDefinition(trx, 'metadataSchema', assignment.schema);
    if (!schema) throw new Error(`Component type ${typeId} assigns schema ${assignment.schema}`);
    schemas.push(schema);
  }
  // A field two schemas group is one definition, supplied once.
  const fieldIds = [
    ...new Set(schemas.flatMap((schema) => schema.definition.entries.map((each) => each.field))),
  ];
  const fields: Versioned<FieldDefinition>[] = [];
  for (const id of fieldIds) {
    const field = await currentDefinition(trx, 'field', id);
    if (!field) throw new Error(`A schema of component type ${typeId} groups field ${id}`);
    fields.push(field);
  }
  return { type, schemas, fields };
}

export interface NewComponent {
  readonly spaceId: string;
  /** Absent: the environment's default (MET-011, MET-012). */
  readonly componentTypeId?: string;
  readonly title: string;
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
  readonly author: string;
}

export type CreateComponentAnswer =
  | { readonly answer: 'created'; readonly version: StoredVersion }
  /** This environment holds no such space. */
  | { readonly answer: 'space.missing' }
  /** This environment holds no such component type, or none at all. */
  | { readonly answer: 'component_type.missing' }
  /** The title, language or direction is not one the content model accepts. */
  | { readonly answer: 'content.invalid' };

// The same pattern `contentDocumentSchema.language` checks (packages/domain/src/content/model/document.ts)
// - duplicated here, as `CreateComponentBody.language` duplicates it a third time in the API contract,
// because the domain does not export the pattern itself, only the schema built from it.
const BCP47 = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?(-[a-z0-9]{5,8})*$/;

/**
 * Creates a component and its version 0.1 (component-editor.md, "Creating a component"): one empty
 * paragraph, as somewhere for the cursor to be (CNT-124); every default the type resolves to applied,
 * a fixed field's included, through `carryForward` from no values at all (metadata.md, "Carrying
 * forward"); and exactly one component type recorded (MET-011). Creating is itself a positive act, so
 * a component has a version from the moment it exists and a baseline can pin it.
 *
 * Who may create here is `create` on the space, decided by the caller before this is called and in the
 * same transaction; this refuses a space or a component type this environment does not hold, which is
 * where a caller's identifier for another environment's ends up.
 *
 * The title, language and direction are validated here, before anything is written:
 * `contentDocumentSchema.title` is `min(1)` with no trim, so a title of spaces alone would otherwise
 * parse - trimmed here, and refused if trimming leaves nothing. Validating first, rather than catching
 * whatever `createArtifact` throws, means nothing else in this content can be mistaken for a bad
 * header: the block identifier is freshly made and the empty paragraph is fixed, so `createArtifact`
 * throwing past this point is a bug, not a caller's mistake, and is left to propagate.
 */
export async function createComponent(
  trx: TenantTransaction,
  input: NewComponent,
): Promise<CreateComponentAnswer> {
  const title = input.title.trim();
  if (title === '' || !BCP47.test(input.language)) return { answer: 'content.invalid' };
  if (input.direction !== 'ltr' && input.direction !== 'rtl') return { answer: 'content.invalid' };

  const space = await trx
    .selectFrom('space')
    .select('id')
    .where('id', '=', input.spaceId)
    .executeTakeFirst();
  if (!space) return { answer: 'space.missing' };
  const typeId = input.componentTypeId ?? (await defaultComponentType(trx));
  if (!typeId) return { answer: 'component_type.missing' };
  const definitions = await currentDefinitionsFor(trx, typeId);
  if (!definitions) return { answer: 'component_type.missing' };
  const effective = resolveComponentFields(
    definitions.type.definition,
    definitions.schemas.map((each) => each.definition),
    definitions.fields.map((each) => each.definition),
  );
  const carried = carryForward({}, effective);
  const content = {
    schemaVersion: 1,
    title,
    language: input.language,
    direction: input.direction,
    content: [
      {
        type: 'paragraph',
        id: blockIdentifierFrom(randomBytes(16)),
        style: 'body',
        content: [],
      },
    ],
  };
  const version = await createArtifact(trx, {
    author: input.author,
    spaceId: input.spaceId,
    substance: {
      kind: 'component',
      content: content as never,
      values: carried.values,
      notCarried: carried.notCarried,
      definitions: definitionsFor(definitions.type, definitions.schemas, definitions.fields),
    },
  });
  return { answer: 'created', version };
}
