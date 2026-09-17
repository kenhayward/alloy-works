import { definitionsFor } from '@alloy-works/domain';
import { currentDefinitionsFor, defaultComponentType } from './creation.js';
import { grant } from './grants.js';
import { findRole } from './roles.js';
import type { TenantTransaction } from './tables.js';
import { createArtifact } from './versions.js';

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
  const ada = await person(trx, input.issuer, 'ada', 'Ada', true);
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

  // Already run: the component in General, not the component type, which 0015 now writes for every
  // environment before anything here runs.
  const seeded = await trx
    .selectFrom('artifact')
    .select('id')
    .where('kind', '=', 'component')
    .where('space_id', '=', general.id)
    .orderBy('created_at')
    .executeTakeFirst();
  if (seeded) return { componentId: seeded.id, created: false };

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
  return { componentId: component.artifactId, created: true };
}
