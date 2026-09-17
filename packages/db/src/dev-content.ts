import {
  DEFINITION_SCHEMA_VERSION,
  definitionsFor,
  type ComponentTypeDefinition,
} from '@alloy-works/domain';
import { grant } from './grants.js';
import { findRole } from './roles.js';
import type { TenantTransaction } from './tables.js';
import { createArtifact, latestVersion } from './versions.js';

/**
 * The development environment's one component type, by a fixed identifier so that running the setup
 * again finds it rather than making a second. Nothing in the product creates a definition yet.
 */
export const TOPIC_TYPE_ID = '5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01';

export interface DevelopmentContent {
  /** The stand-in provider's issuer, which the people below sign in through. */
  readonly issuer: string;
}

export interface SeededContent {
  readonly componentId: string;
  /** Whether this run made the type and the component, or found them. */
  readonly created: boolean;
}

/**
 * A principal by the identity the stand-in gives them: found by it once they have signed in; found by
 * a waiting invitation to their address - Ada's, which `pnpm dev:setup` makes - until they do; and
 * otherwise made now, by that identity, so a grant can name them before they sign in.
 */
async function person(
  trx: TenantTransaction,
  issuer: string,
  subject: string,
  name: string,
): Promise<string> {
  const email = `${subject}@example.com`;
  const known = await trx
    .selectFrom('principal')
    .select('id')
    .where('issuer', '=', issuer)
    .where('subject', '=', subject)
    .executeTakeFirst();
  if (known) return known.id;
  const invited = await trx
    .selectFrom('invitation')
    .select('principal_id')
    .where('email', '=', email)
    .where('accepted_at', 'is', null)
    .executeTakeFirst();
  if (invited) return invited.principal_id;
  const made = await trx
    .insertInto('principal')
    .values({ issuer, subject, email, display_name: name })
    .returning('id')
    .executeTakeFirstOrThrow();
  return made.id;
}

/**
 * Development only: something to open in the editor, and somebody allowed to edit it. Nothing in the
 * product yet creates a component type, creates a component or grants a role through a route (the editor
 * plan's decisions 2 and 3), so this makes, in the environment's General space:
 *
 * - the component type Topic, assigning no schemas;
 * - the component "Install the printer", at 0.1;
 * - Ada, through her invitation where one waits, and Grace, as a principal by the identity the stand-in
 *   gives her, each allowed Author on General, so either can edit and each can see the other's lock.
 *   Grace authors the component: a principal still waiting on an invitation must be able to go when
 *   the invitation is withdrawn, which one that authored a version cannot.
 *
 * Alice is left alone: she signs in and may read nothing. Safe to run again.
 */
export async function seedDevelopmentContent(
  trx: TenantTransaction,
  input: DevelopmentContent,
): Promise<SeededContent> {
  const ada = await person(trx, input.issuer, 'ada', 'Ada');
  const grace = await person(trx, input.issuer, 'grace', 'Grace');
  const general = await trx
    .selectFrom('space')
    .select('id')
    .where('name', '=', 'General')
    .executeTakeFirstOrThrow();
  const author = await findRole(trx, 'Author');
  if (!author) throw new Error('This environment has no Author role to grant');
  for (const principal of [ada, grace]) {
    const answer = await grant(trx, {
      roleId: author.id,
      subject: { principal },
      level: { kind: 'space', id: general.id },
      effect: 'allow',
      grantedBy: grace,
    });
    if ('refused' in answer && answer.refused !== 'grant.duplicate') {
      throw new Error(`Author on General was refused: ${answer.refused}`);
    }
  }

  const existing = await latestVersion(trx, TOPIC_TYPE_ID);
  if (existing) {
    const component = await trx
      .selectFrom('artifact')
      .select('id')
      .where('kind', '=', 'component')
      .where('space_id', '=', general.id)
      .orderBy('created_at')
      .executeTakeFirstOrThrow();
    return { componentId: component.id, created: false };
  }

  const topic: ComponentTypeDefinition = {
    schemaVersion: DEFINITION_SCHEMA_VERSION,
    id: TOPIC_TYPE_ID,
    name: 'Topic',
    assignments: [],
  };
  const type = await createArtifact(trx, {
    author: grace,
    substance: { kind: 'componentType', content: topic },
  });
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
      definitions: definitionsFor({ version: type.id, definition: topic }, [], []),
    },
  });
  return { componentId: component.artifactId, created: true };
}
