import { DEFAULT_PROMPT_LIBRARY_ID, type Prompt } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import {
  createLibrary,
  defaultLibraryId,
  libraryPrompts,
  listLibraries,
  readLibrary,
  recordLibraryVersion,
} from './prompt-libraries.js';
import { createPrompt, recordPromptVersion, type StoredPrompt } from './prompts.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import { DEFAULT_THEME_ID } from './themes.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { versionDigests } from './version-digest.js';
import { decideGate } from './workflow-gates.js';
import { moveArtifact } from './workflow.js';

const ISSUER = 'https://idp.example';

const prompt = (title: string): Prompt => ({
  schemaVersion: 1,
  title,
  description: '',
  instructions: 'Summarise.',
  context: [{ source: 'outline', scope: 'part' }],
  output: { componentType: null },
  models: { purpose: 'drafting', accepts: ['claude-sonnet-5-5'] },
});

describe('a prompt library', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let general: string;
  let quality: string;

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const made = (title: string, spaceId = general) =>
    service.withTenant(production, async (trx) => {
      const answer = await createPrompt(trx, { author: grace, spaceId, prompt: prompt(title) });
      if (answer.answer !== 'created') throw new Error(JSON.stringify(answer));
      return answer.prompt;
    });

  /** Grace submits it; Ada, who is not its author, approves the version she sees. */
  const approved = (stored: StoredPrompt) =>
    service.withTenant(production, async (trx) => {
      const may = () => true;
      const moved = await moveArtifact(trx, {
        artifactId: stored.id,
        kind: 'prompt',
        transition: 'submit',
        from: 'draft',
        by: grace,
        may,
      });
      if (moved.answer !== 'moved') throw new Error(moved.answer);
      const passed = await decideGate(trx, {
        artifactId: stored.id,
        kind: 'prompt',
        transition: 'approve',
        version: stored.version.id,
        decision: 'approved',
        by: ada,
        may,
      });
      if (passed.answer !== 'passed') throw new Error(passed.answer);
    });

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
      // Ada reads General and Quality; Grace reads General alone.
      const reader = await findRole(trx, 'Reader');
      for (const [principal, space] of [
        [ada, general],
        [ada, quality],
        [grace, general],
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

  it('TPL-071 every tenant holds an empty default library, unauthored, its digests those the migration states', async () => {
    const library = await service.withTenant(production, async (trx) => {
      expect(await defaultLibraryId(trx)).toBe(DEFAULT_PROMPT_LIBRARY_ID);
      return readLibrary(trx, DEFAULT_PROMPT_LIBRARY_ID);
    });
    expect(library).toMatchObject({
      isDefault: true,
      library: { schemaVersion: 1, name: 'No prompts', prompts: [] },
      version: { author: null, revision: 0, version: 1 },
    });
    const digests = versionDigests({ kind: 'promptLibrary', content: library!.library });
    expect(digests).toEqual({
      contentHash: library!.version.contentHash,
      versionDigest: library!.version.versionDigest,
    });
    // Nobody changes which library is the default, nor removes it.
    await expect(
      service.withTenant(production, (trx) => trx.deleteFrom('prompt_library_default').execute()),
    ).rejects.toThrow();
  });

  it('lists prompts of the tenant alone, each named once, every change a version', async () => {
    const one = await made('One');
    const library = await service.withTenant(production, (trx) =>
      createLibrary(trx, {
        author: ada,
        library: { schemaVersion: 1, name: 'Ours', prompts: [one.id] },
      }),
    );
    expect(library.answer).toBe('created');
    // The default theme: an artifact of the tenant's, and no prompt.
    const component = DEFAULT_THEME_ID;
    const refused = await service.withTenant(production, (trx) =>
      createLibrary(trx, {
        author: ada,
        library: { schemaVersion: 1, name: 'Wrong', prompts: [one.id, component] },
      }),
    );
    expect(refused).toMatchObject({
      answer: 'library.refused',
      problems: [{ path: 'prompts.1' }],
    });
    const twice = await service.withTenant(production, (trx) =>
      createLibrary(trx, {
        author: ada,
        library: { schemaVersion: 1, name: 'Twice', prompts: [one.id, one.id] },
      }),
    );
    expect(twice.answer).toBe('library.refused');

    const stored = library.answer === 'created' ? library.library : undefined;
    const renamed = await service.withTenant(production, (trx) =>
      recordLibraryVersion(trx, {
        author: ada,
        id: stored!.id,
        openedFrom: stored!.version.id,
        library: { ...stored!.library, name: 'Ours, renamed' },
      }),
    );
    expect(renamed).toMatchObject({ answer: 'recorded', library: { version: { version: 2 } } });
    const listed = await service.withTenant(production, (trx) => listLibraries(trx));
    expect(listed.map((each) => each.library.name)).toEqual(['No prompts', 'Ours, renamed']);
  });

  it('GEN-001 runs each prompt it lists at its latest approved revision, one never approved at none, one a reader may not read hidden', async () => {
    const approvedOne = await made('Approved');
    const draftOne = await made('Never approved');
    const elsewhere = await made('In Quality', quality);
    await approved(approvedOne);
    // Saved after its approval: a new draft, which the library does not run (G4-F).
    const later = await service.withTenant(production, (trx) =>
      recordPromptVersion(trx, {
        author: grace,
        id: approvedOne.id,
        openedFrom: approvedOne.version.id,
        prompt: prompt('Approved, then changed'),
      }),
    );
    expect(later.answer).toBe('recorded');
    const listed = await service.withTenant(production, (trx) =>
      libraryPrompts(trx, grace, {
        schemaVersion: 1,
        name: 'Ours',
        prompts: [approvedOne.id, draftOne.id, elsewhere.id],
      }),
    );
    expect(listed).toEqual([
      expect.objectContaining({
        id: approvedOne.id,
        state: 'approved',
        revision: { number: 1, versionId: approvedOne.version.id },
        prompt: expect.objectContaining({ title: 'Approved' }),
      }),
      expect.objectContaining({ id: draftOne.id, state: 'unapproved', title: 'Never approved' }),
      { id: elsewhere.id, state: 'hidden' },
    ]);
  });

  it('refuses a writer listing a prompt they may not read as it refuses one not there, and keeps one already listed', async () => {
    const hidden = await made('Kept in Quality', quality);
    const missing = '0b6f6a4e-8f4e-4c2b-9a51-3a3b1d1f2c09';
    const asGrace = await service.withTenant(production, (trx) =>
      createLibrary(trx, {
        author: grace,
        library: { schemaVersion: 1, name: 'Peeking', prompts: [hidden.id, missing] },
      }),
    );
    expect(asGrace).toEqual({
      answer: 'library.refused',
      problems: [
        {
          rule: 'library_invalid',
          path: 'prompts.0',
          message: 'This names no prompt you may read',
        },
        {
          rule: 'library_invalid',
          path: 'prompts.1',
          message: 'This names no prompt you may read',
        },
      ],
    });
    // Ada reads Quality and lists it; Grace may still rename the library, keeping it listed.
    const asAda = await service.withTenant(production, (trx) =>
      createLibrary(trx, {
        author: ada,
        library: { schemaVersion: 1, name: 'Quality prompts', prompts: [hidden.id] },
      }),
    );
    const stored = asAda.answer === 'created' ? asAda.library : undefined;
    const renamed = await service.withTenant(production, (trx) =>
      recordLibraryVersion(trx, {
        author: grace,
        id: stored!.id,
        openedFrom: stored!.version.id,
        library: { ...stored!.library, name: 'Quality prompts, renamed' },
      }),
    );
    expect(renamed.answer).toBe('recorded');
  });
});
