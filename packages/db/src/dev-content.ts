import {
  DEFINITION_SCHEMA_VERSION,
  TEMPLATE_SCHEMA_VERSION,
  definitionsFor,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { currentDefinitionsFor, defaultComponentType } from './creation.js';
import { grant } from './grants.js';
import { DEFAULT_LAYOUT_ID } from './layouts.js';
import { findRole } from './roles.js';
import type { TenantTransaction } from './tables.js';
import { createTemplate } from './templates.js';
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
const REVIEWER_FIELD = '0d5e7a11-0000-4000-8000-00000000f1e1';
const REVIEW_SCHEMA = '0d5e7a11-0000-4000-8000-00000000c4e3';

/**
 * A template in General to make a document from (templates.md): Report, whose Introduction and
 * Conclusion a document may not publish without and whose sections keep their order, over the
 * environment's theme and layout, assigning Review at the document's level with nothing required -
 * a field no page can fill in yet (W5) must not stop a document publishing. Made once.
 */
async function seedReportTemplate(trx: TenantTransaction, space: string, designer: string) {
  const exists = await trx
    .selectFrom('artifact')
    .select('id')
    .where('kind', '=', 'template')
    .where('space_id', '=', space)
    .executeTakeFirst();
  if (exists) return;
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
      schemas: [{ schema: REVIEW_SCHEMA, level: 'document', requires: [] }],
      outline: {
        sections: [
          section('introduction', 'Introduction', true),
          section('method', 'Method', false),
          section('results', 'Results', false),
          section('conclusion', 'Conclusion', true),
        ],
      },
      changes: { add: true, remove: true, reorder: false },
    },
  });
  if (made.answer !== 'created') throw new Error(`The Report template was refused: ${made.answer}`);
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
