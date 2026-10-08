import {
  DEFINITION_SCHEMA_VERSION,
  TEMPLATE_SCHEMA_VERSION,
  definitionsFor,
  permissions,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { currentDefinitionsFor, defaultComponentType } from './creation.js';
import { grant } from './grants.js';
import { DEFAULT_LAYOUT_ID } from './layouts.js';
import { createRole, findRole } from './roles.js';
import type { TenantTransaction } from './tables.js';
import { createTemplate, recordTemplateVersion } from './templates.js';
import { DEFAULT_THEME_ID } from './themes.js';
import { createArtifact, latestVersion } from './versions.js';

// The starter component type's identifier lives in `creation.ts` and is exported from there directly
// (`@alloy-works/db`'s `index.ts`), since 0015 gives every environment one at migration time rather
// than this module making it.

export interface DevelopmentContent {
  /** The stand-in provider's issuer, which the people below sign in through. */
  readonly issuer: string;
}

export interface SeededContent {
  readonly componentId: string;
  /** Whether this run made the component, or found it. */
  readonly created: boolean;
}

/**
 * A principal by the identity the stand-in gives them: found by it once they have signed in; found by
 * a waiting invitation to their address - Ada's, which `pnpm dev:setup` makes, and only ever checked
 * for Ada - until they do; and otherwise made now, by that identity, so a grant can name them before
 * they sign in. Restricted to Ada's own address: anybody else's `person()` call never reads the
 * invitation table at all, so a waiting invitation that happens to name their address - one somebody
 * made a different way, through the service's own invitation route in a development database that has
 * seen one - is never mistaken for identifying them.
 */
async function person(
  trx: TenantTransaction,
  issuer: string,
  subject: string,
  name: string,
  checkInvitation = false,
): Promise<string> {
  const email = `${subject}@example.com`;
  const known = await trx
    .selectFrom('principal')
    .select('id')
    .where('issuer', '=', issuer)
    .where('subject', '=', subject)
    .executeTakeFirst();
  if (known) return known.id;
  if (checkInvitation) {
    const invited = await trx
      .selectFrom('invitation')
      .select('principal_id')
      .where('email', '=', email)
      .where('accepted_at', 'is', null)
      .executeTakeFirst();
    if (invited) return invited.principal_id;
  }
  const made = await trx
    .insertInto('principal')
    .values({ issuer, subject, email, display_name: name })
    .returning('id')
    .executeTakeFirstOrThrow();
  return made.id;
}

/**
 * Development only: something to open in the editor, and somebody allowed to edit it. The component
 * type is no longer this module's to make - 0015 gives every environment one, unauthored, at migration
 * time (STARTER_COMPONENT_TYPE_ID) - and nothing in the product yet creates a component or grants a
 * role through a route (the editor plan's decision 3), so this makes, in the environment's General
 * space:
 *
 * - the component "Install the printer", at 0.1, over the environment's default component type;
 * - Ada, through her invitation where one waits, and Grace, as a principal by the identity the stand-in
 *   gives her, each allowed Author and Publisher on General, so either can edit and publish and each
 *   can see the other's lock.
 *   Grace authors the component: a principal still waiting on an invitation must be able to go when
 *   the invitation is withdrawn, which one that authored a version cannot.
 *
 * Alice is left alone: she signs in and may read nothing. Safe to run again.
 */
export async function seedDevelopmentContent(
  trx: TenantTransaction,
  input: DevelopmentContent,
): Promise<SeededContent> {
  const ada = await person(trx, input.issuer, 'ada', 'Ada', true);
  const grace = await person(trx, input.issuer, 'grace', 'Grace');
  const general = await trx
    .selectFrom('space')
    .select('id')
    .where('name', '=', 'General')
    .executeTakeFirstOrThrow();
  // Author, and Publisher: an environment granting nobody a role that holds `publish` is one where
  // nothing can be published (the first publishing plan, decision N).
  for (const name of ['Author', 'Publisher']) {
    const role = await findRole(trx, name);
    if (!role) throw new Error(`This environment has no ${name} role to grant`);
    for (const principal of [ada, grace]) {
      const answer = await grant(trx, {
        roleId: role.id,
        subject: { principal },
        level: { kind: 'space', id: general.id },
        effect: 'allow',
        grantedBy: grace,
      });
      if ('refused' in answer && answer.refused !== 'grant.duplicate') {
        throw new Error(`${name} on General was refused: ${answer.refused}`);
      }
    }
  }

  // Designer on General too, so either may make and change a template there (TPL-006).
  const designer = await findRole(trx, 'Designer');
  if (!designer) throw new Error('This environment has no Designer role to grant');
  for (const principal of [ada, grace]) {
    const answer = await grant(trx, {
      roleId: designer.id,
      subject: { principal },
      level: { kind: 'space', id: general.id },
      effect: 'allow',
      grantedBy: grace,
    });
    if ('refused' in answer && answer.refused !== 'grant.duplicate') {
      throw new Error(`Designer on General was refused: ${answer.refused}`);
    }
  }
  await seedReportTemplate(trx, general.id, grace);

  // Already run: the component in General, not the component type, which 0015 now writes for every
  // environment before anything here runs.
  const seeded = await trx
    .selectFrom('artifact')
    .select('id')
    .where('kind', '=', 'component')
    .where('space_id', '=', general.id)
    .orderBy('created_at')
    .executeTakeFirst();
  if (seeded) {
    await seedProcedure(trx, general.id, grace);
    return { componentId: seeded.id, created: false };
  }

  const typeId = await defaultComponentType(trx);
  if (!typeId) throw new Error('This environment declares no default component type');
  const definitions = await currentDefinitionsFor(trx, typeId);
  if (!definitions) throw new Error('This environment holds no default component type');

  const component = await createArtifact(trx, {
    author: grace,
    spaceId: general.id,
    substance: {
      kind: 'component',
      content: {
        schemaVersion: 1,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        content: [
          {
            type: 'paragraph',
            id: 'seed-unbox',
            style: 'body',
            content: [
              { type: 'text', value: 'Unbox the printer and remove the packing tape.', marks: [] },
            ],
          },
          {
            type: 'paragraph',
            id: 'seed-connect',
            style: 'body',
            content: [
              {
                type: 'text',
                value: 'Connect it to power, then run the setup assistant.',
                marks: [],
              },
            ],
          },
        ],
      },
      values: {},
      notCarried: [],
      definitions: definitionsFor(definitions.type, definitions.schemas, definitions.fields),
    },
  });
  // After the printer, so the printer stays the component this answers on every run.
  await seedProcedure(trx, general.id, grace);
  return { componentId: component.artifactId, created: true };
}

/** Development's Review schema and its one field, and the template assigning it. Fixed, so a rerun finds them. */
export const REVIEWER_FIELD = '0d5e7a11-0000-4000-8000-00000000f1e1';
const REVIEW_SCHEMA = '0d5e7a11-0000-4000-8000-00000000c4e3';
/** Development's Reporting schema and its Period field, which Report's `period` seeds (TP2-G). */
export const PERIOD_FIELD = '0d5e7a11-0000-4000-8000-00000000f1e4';
const REPORTING_SCHEMA = '0d5e7a11-0000-4000-8000-00000000c4e5';

/**
 * The Report template's parameters (the TP1 plan, Task 5; the TP2 plan, TP2-G), each optional so
 * nothing made from it before must now be given one: the reviewer, changeable and seeding the Reviewer
 * field; the date issued, fixed and offered to bindings; and the period, a changeable date seeding the
 * Period field and offered to bindings, so one parameter does both.
 */
const REPORT_PARAMETERS = [
  {
    name: 'reviewer',
    type: { base: 'text' as const },
    required: false,
    list: false,
    changeable: true,
    feeds: { field: REVIEWER_FIELD, arguments: false },
  },
  {
    name: 'issued',
    type: { base: 'date' as const },
    required: false,
    list: false,
    changeable: false,
    feeds: { arguments: true },
  },
  {
    name: 'period',
    type: { base: 'date' as const },
    required: false,
    list: false,
    changeable: true,
    feeds: { field: PERIOD_FIELD, arguments: true },
  },
];

/** The schemas Report assigns at the document's level: Review, and Reporting for the period. */
const REPORT_SCHEMAS = [
  { schema: REVIEW_SCHEMA, level: 'document' as const, requires: [] },
  { schema: REPORTING_SCHEMA, level: 'document' as const, requires: [] },
];

/**
 * A template in General to make a document from (templates.md): Report, whose Introduction and
 * Conclusion a document may not publish without and whose sections keep their order, over the
 * environment's theme and layout, assigning Review and Reporting at the document's level with nothing
 * required - a field no page can fill in yet (W5) must not stop a document publishing. Made once; a
 * Report made before a parameter of its own is given those it lacks, and their schemas, as one new
 * version.
 */
async function seedReportTemplate(trx: TenantTransaction, space: string, designer: string) {
  await seedReportFields(trx, designer);
  // Report by its name and the designer who seeds it, never another template somebody made in General.
  const exists = await trx
    .selectFrom('artifact as a')
    .innerJoin('artifact_version as v', 'v.artifact_id', 'a.id')
    .select('a.id')
    .where('a.kind', '=', 'template')
    .where('a.space_id', '=', space)
    .where('v.author_id', '=', designer)
    .where(sql<boolean>`v.content ->> 'name' = 'Report'`)
    .executeTakeFirst();
  if (exists) {
    const latest = await latestVersion(trx, exists.id);
    const content = latest?.content as
      { parameters?: { name: string }[]; schemas?: { schema: string }[] } | undefined;
    if (latest === undefined || content === undefined) return;
    const parameters = content.parameters ?? [];
    const schemas = content.schemas ?? [];
    const lacking = REPORT_PARAMETERS.filter(
      (each) => !parameters.some((held) => held.name === each.name),
    );
    const unassigned = REPORT_SCHEMAS.filter(
      (each) => !schemas.some((held) => held.schema === each.schema),
    );
    if (lacking.length === 0 && unassigned.length === 0) return;
    const recorded = await recordTemplateVersion(trx, {
      templateId: exists.id,
      openedFrom: latest.id,
      definition: {
        ...content,
        schemas: [...schemas, ...unassigned],
        parameters: [...parameters, ...lacking],
      },
      author: designer,
    });
    if (recorded.answer !== 'recorded') {
      throw new Error(`The Report template's parameters were refused: ${recorded.answer}`);
    }
    return;
  }
  const section = (key: string, words: string, required: boolean) => ({
    key,
    title: [{ type: 'text' as const, value: words, marks: [] }],
    required,
    numbered: true,
    matter: 'body' as const,
    pageBreak: 'none' as const,
    children: [],
  });
  const made = await createTemplate(trx, {
    spaceId: space,
    author: designer,
    definition: {
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      name: 'Report',
      theme: DEFAULT_THEME_ID,
      layout: DEFAULT_LAYOUT_ID,
      schemas: [...REPORT_SCHEMAS],
      outline: {
        sections: [
          section('introduction', 'Introduction', true),
          section('method', 'Method', false),
          section('results', 'Results', false),
          section('conclusion', 'Conclusion', true),
        ],
      },
      changes: { add: true, remove: true, reorder: false },
      parameters: [...REPORT_PARAMETERS],
    },
  });
  if (made.answer !== 'created') throw new Error(`The Report template was refused: ${made.answer}`);
}

/** Report's fields and the schemas grouping them, each made once: Reviewer in Review, Period in Reporting. */
async function seedReportFields(trx: TenantTransaction, designer: string) {
  const identity = (id: string, name: string) =>
    ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name }) as const;
  if (!(await latestVersion(trx, REVIEWER_FIELD))) {
    await createArtifact(trx, {
      author: designer,
      substance: {
        kind: 'field',
        content: {
          ...identity(REVIEWER_FIELD, 'Reviewer'),
          dataType: 'text',
          multiplicity: 'one',
          validation: {},
        },
      },
    });
  }
  if (!(await latestVersion(trx, REVIEW_SCHEMA))) {
    await createArtifact(trx, {
      author: designer,
      substance: {
        kind: 'metadataSchema',
        content: {
          ...identity(REVIEW_SCHEMA, 'Review'),
          entries: [{ field: REVIEWER_FIELD, required: false, fixed: false }],
        },
      },
    });
  }
  if (!(await latestVersion(trx, PERIOD_FIELD))) {
    await createArtifact(trx, {
      author: designer,
      substance: {
        kind: 'field',
        content: {
          ...identity(PERIOD_FIELD, 'Period'),
          dataType: 'date',
          multiplicity: 'one',
          validation: {},
        },
      },
    });
  }
  if (!(await latestVersion(trx, REPORTING_SCHEMA))) {
    await createArtifact(trx, {
      author: designer,
      substance: {
        kind: 'metadataSchema',
        content: {
          ...identity(REPORTING_SCHEMA, 'Reporting'),
          entries: [{ field: PERIOD_FIELD, required: false, fixed: false }],
        },
      },
    });
  }
}

/** Development's Procedure type and what it assigns. Fixed, so a rerun finds them. */
const OWNER_FIELD = '0d5e7a11-0000-4000-8000-00000000f1e2';
const DUE_FIELD = '0d5e7a11-0000-4000-8000-00000000f1e3';
const SIGN_OFF_SCHEMA = '0d5e7a11-0000-4000-8000-00000000c4e4';
const PROCEDURE_TYPE = '0d5e7a11-0000-4000-8000-0000000071e5';

/**
 * A component type whose components have fields to fill in, and one component of it in General
 * (definitions.md, W5): Procedure, assigning Sign-off - who owns it, required, and when it is due -
 * and development's Review, beside it. Made once; the component is found by its title.
 */
async function seedProcedure(trx: TenantTransaction, space: string, author: string) {
  const identity = (id: string, name: string) =>
    ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name }) as const;
  const field = async (id: string, name: string, dataType: 'user' | 'date') => {
    if (await latestVersion(trx, id)) return;
    await createArtifact(trx, {
      author,
      substance: {
        kind: 'field',
        content: { ...identity(id, name), dataType, multiplicity: 'one', validation: {} },
      },
    });
  };
  await field(OWNER_FIELD, 'Owner', 'user');
  await field(DUE_FIELD, 'Due', 'date');
  if (!(await latestVersion(trx, SIGN_OFF_SCHEMA))) {
    await createArtifact(trx, {
      author,
      substance: {
        kind: 'metadataSchema',
        content: {
          ...identity(SIGN_OFF_SCHEMA, 'Sign-off'),
          entries: [
            { field: OWNER_FIELD, required: true, fixed: false },
            { field: DUE_FIELD, required: false, fixed: false },
          ],
        },
      },
    });
  }
  if (!(await latestVersion(trx, PROCEDURE_TYPE))) {
    await createArtifact(trx, {
      author,
      substance: {
        kind: 'componentType',
        content: {
          ...identity(PROCEDURE_TYPE, 'Procedure'),
          assignments: [
            { schema: SIGN_OFF_SCHEMA, requires: [] },
            { schema: REVIEW_SCHEMA, requires: [] },
          ],
        },
      },
    });
  }
  const exists = await trx
    .selectFrom('artifact_version')
    .select('artifact_id')
    .where('kind', '=', 'component')
    .where(sql<boolean>`content ->> 'title' = 'Calibrate the scanner'`)
    .executeTakeFirst();
  if (exists) return;
  const definitions = await currentDefinitionsFor(trx, PROCEDURE_TYPE);
  if (!definitions) throw new Error('The Procedure type was not made');
  await createArtifact(trx, {
    author,
    spaceId: space,
    substance: {
      kind: 'component',
      content: {
        schemaVersion: 1,
        title: 'Calibrate the scanner',
        language: 'en-GB',
        direction: 'ltr',
        content: [
          {
            type: 'paragraph',
            id: 'seed-calibrate',
            style: 'body',
            content: [
              {
                type: 'text',
                value: 'Scan the calibration sheet and compare it with the reference print.',
                marks: [],
              },
            ],
          },
        ],
      },
      values: {},
      notCarried: [],
      definitions: definitionsFor(definitions.type, definitions.schemas, definitions.fields),
    },
  });
}

/**
 * Development only: somebody who may use a connection and write SQL against one, and somebody who may
 * use one and write no SQL. No starting role holds `use_connection` or `write_sql`, so either is always
 * granted on purpose (data.md, "Permissions"); this makes a role of the environment's own, Connection
 * user, holding `read`, `use_connection` and `write_sql` (D2-T), and allows it to Ada on General, where
 * she may already make a connection as the environment's administrator; and a second, Query builder,
 * holding `read` and `use_connection`, allowed to Grace on General, who builds queries without writing
 * SQL (the D4 plan, D4-J). Safe to run again, and a role D1's setup made gains `write_sql`.
 */
export async function seedDevelopmentConnectionUse(
  trx: TenantTransaction,
  input: DevelopmentContent,
): Promise<void> {
  const ada = await person(trx, input.issuer, 'ada', 'Ada', true);
  const general = await trx
    .selectFrom('space')
    .select('id')
    .where('name', '=', 'General')
    .executeTakeFirstOrThrow();
  const held = ['read', 'use_connection', 'write_sql'] as const;
  let role = await findRole(trx, 'Connection user');
  if (!role) {
    const made = await createRole(trx, 'Connection user', held);
    if (!('role' in made)) throw new Error(`Connection user was refused: ${made.refused}`);
    role = made.role;
  } else if (!role.permissions.includes('write_sql')) {
    // Made by D1's setup, before a definition could be written: it gains write_sql (D2-T).
    await trx
      .updateTable('role')
      .set({ permissions: [...held] })
      .where('id', '=', role.id)
      .execute();
  }
  const answer = await grant(trx, {
    roleId: role.id,
    subject: { principal: ada },
    level: { kind: 'space', id: general.id },
    effect: 'allow',
    grantedBy: ada,
  });
  if ('refused' in answer && answer.refused !== 'grant.duplicate') {
    throw new Error(`Connection user on General was refused: ${answer.refused}`);
  }

  const grace = await person(trx, input.issuer, 'grace', 'Grace');
  let builder = await findRole(trx, 'Query builder');
  if (!builder) {
    const made = await createRole(trx, 'Query builder', ['read', 'use_connection']);
    if (!('role' in made)) throw new Error(`Query builder was refused: ${made.refused}`);
    builder = made.role;
  }
  const builds = await grant(trx, {
    roleId: builder.id,
    subject: { principal: grace },
    level: { kind: 'space', id: general.id },
    effect: 'allow',
    grantedBy: ada,
  });
  if ('refused' in builds && builds.refused !== 'grant.duplicate') {
    throw new Error(`Query builder on General was refused: ${builds.refused}`);
  }

  // And Ada may do anything anywhere in a development environment: every permission in the closed set,
  // across the environment, so no space, connection or act is closed to the person trying the product.
  // A role seeded before a permission joined the set gains it here.
  let full = await findRole(trx, 'Full access (development)');
  if (!full) {
    const made = await createRole(trx, 'Full access (development)', permissions);
    if (!('role' in made)) throw new Error(`Full access was refused: ${made.refused}`);
    full = made.role;
  } else if (full.permissions.length !== permissions.length) {
    await trx
      .updateTable('role')
      .set({ permissions: [...permissions] })
      .where('id', '=', full.id)
      .execute();
  }
  const everywhere = await grant(trx, {
    roleId: full.id,
    subject: { principal: ada },
    level: { kind: 'tenant' },
    effect: 'allow',
    grantedBy: ada,
  });
  if ('refused' in everywhere && everywhere.refused !== 'grant.duplicate') {
    throw new Error(`Full access across the environment was refused: ${everywhere.refused}`);
  }
}
