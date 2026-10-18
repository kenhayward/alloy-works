import { type Prompt } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import {
  createPrompt,
  listReadablePrompts,
  readPrompt,
  recordPromptVersion,
  type StoredPrompt,
} from './prompts.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const ISSUER = 'https://idp.example';
const NOWHERE = '0b6f6a4e-8f4e-4c2b-9a51-3a3b1d1f2c09';

const prompt = (over: Partial<Prompt> = {}): Prompt => ({
  schemaVersion: 1,
  title: 'Summarise the section',
  description: 'A short summary for the reader.',
  instructions: 'Summarise this for {{audience}}.',
  context: [
    { source: 'outline', scope: 'section' },
    { source: 'parameters', names: ['audience'] },
  ],
  output: { componentType: null },
  models: { purpose: 'drafting', accepts: ['claude-sonnet-5-5'] },
  ...over,
});

describe('a prompt', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let general: string;
  let quality: string;
  let paragraph: string;

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const made = (over: Partial<Prompt> = {}, spaceId = general) =>
    service.withTenant(production, async (trx) => {
      const answer = await createPrompt(trx, { author: ada, spaceId, prompt: prompt(over) });
      if (answer.answer !== 'created') throw new Error(JSON.stringify(answer));
      return answer.prompt;
    });

  const version = (current: StoredPrompt, over: Partial<Prompt>, openedFrom = current.version.id) =>
    service.withTenant(production, (trx) =>
      recordPromptVersion(trx, {
        author: ada,
        id: current.id,
        openedFrom,
        prompt: { ...current.prompt, ...over },
      }),
    );

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    await service.withTenant(production, async (trx) => {
      ada = await person(trx, 'ada', 'Ada');
      grace = await person(trx, 'grace', 'Grace');
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      paragraph = (
        await trx
          .selectFrom('artifact')
          .select('id')
          .where('kind', '=', 'componentType')
          .limit(1)
          .executeTakeFirstOrThrow()
      ).id;
      // Ada reads General and Quality; Grace reads Quality alone.
      const reader = await findRole(trx, 'Reader');
      for (const [principal, space] of [
        [ada, general],
        [ada, quality],
        [grace, quality],
      ] as const) {
        await grant(trx, {
          roleId: reader!.id,
          subject: { principal },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        });
      }
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('is made in one space at 0.1, every change a version, and read back', async () => {
    const first = await made({ output: { componentType: paragraph } });
    expect(first.space).toEqual({ id: general, name: 'General' });
    expect(first.version).toMatchObject({ revision: 0, version: 1, author: ada, kind: 'prompt' });
    const next = await version(first, { title: 'Summarise the section briefly' });
    expect(next.answer).toBe('recorded');
    const read = await service.withTenant(production, (trx) => readPrompt(trx, first.id));
    expect(read?.prompt.title).toBe('Summarise the section briefly');
    expect(read?.version.version).toBe(2);
    // Saved unchanged, nothing is cut; from an older version, the newer one is answered.
    expect((await version(read!, {})).answer).toBe('version.unchanged');
    const stale = await version(read!, { title: 'Again' }, first.version.id);
    expect(stale).toMatchObject({ answer: 'version.precondition' });
  });

  it('is refused naming a definition the tenant does not hold, or one of another kind', async () => {
    const answer = await service.withTenant(production, (trx) =>
      createPrompt(trx, {
        author: ada,
        spaceId: general,
        prompt: prompt({
          output: { componentType: NOWHERE },
          context: [
            { source: 'related', type: paragraph, direction: 'out' },
            { source: 'field', field: NOWHERE, value: 'Ready' },
          ],
          instructions: 'Summarise.',
        }),
      }),
    );
    expect(answer.answer).toBe('prompt.refused');
    expect(answer.answer === 'prompt.refused' && answer.problems.map((each) => each.path)).toEqual([
      'output.componentType',
      'context.0.type',
      'context.1.field',
    ]);
  });

  it('is refused by its checks on every write, a stored one read by its shape', async () => {
    const answer = await service.withTenant(production, (trx) =>
      createPrompt(trx, {
        author: ada,
        spaceId: general,
        prompt: prompt({ instructions: 'For {{region}}.' }),
      }),
    );
    expect(answer).toMatchObject({ answer: 'prompt.refused' });
    const first = await made();
    expect((await version(first, { context: [] })).answer).toBe('prompt.refused');
  });

  it("lists the prompts a person may read, by title, with each one's space and purpose", async () => {
    await made(
      { title: 'Quality summary', models: { purpose: 'summarising', accepts: ['m'] } },
      quality,
    );
    const asGrace = await service.withTenant(production, (trx) => listReadablePrompts(trx, grace));
    expect(asGrace?.items.map((each) => [each.title, each.space.name, each.purpose])).toEqual([
      ['Quality summary', 'Quality', 'summarising'],
    ]);
    const asAda = await service.withTenant(production, (trx) =>
      listReadablePrompts(trx, ada, { limit: 100 }, { spaces: [quality] }),
    );
    expect(asAda?.items.map((each) => each.title)).toEqual(['Quality summary']);
    expect(asAda?.facets.spaces.map((each) => each.label).sort()).toEqual(['General', 'Quality']);
  });
});
