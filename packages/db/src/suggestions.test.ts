import type { BlockNode, ContentDocument } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { claimLock, saveIteration } from './editing.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import {
  acceptSuggestion,
  makeSuggestion,
  readSuggestion,
  rejectSuggestion,
  withdrawSuggestion,
} from './suggestions.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { latestVersion, recordVersion, substanceOf, type StoredVersion } from './versions.js';

const text = (value: string) => ({ type: 'text' as const, value, marks: [] });
const para = (id: string, value: string): BlockNode => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [text(value)],
});
const SESSION = '00000000-0000-4000-8000-00000000abcd';

describe('suggestions', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let general = '';

  const tenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);
  const contentOf = (version: StoredVersion) => version.content as ContentDocument;
  const withBlocks = (version: StoredVersion, ...blocks: BlockNode[]): ContentDocument => ({
    ...contentOf(version),
    content: blocks,
  });

  /** A component in General, by Ada, at a version holding a and b. */
  const component = async () => {
    const made = await tenant((trx) =>
      createComponent(trx, {
        spaceId: general,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      }),
    );
    if (made.answer !== 'created') throw new Error(made.answer);
    return revise(made.version, para('a', 'Unbox it.'), para('b', 'Set the tray.'));
  };
  const revise = (version: StoredVersion, ...blocks: BlockNode[]) =>
    tenant(async (trx) => {
      const substance = substanceOf(version);
      if (substance.kind !== 'component') throw new Error('not a component');
      const next = await recordVersion(trx, {
        artifactId: version.artifactId,
        openedFrom: version.id,
        author: ada,
        substance: { ...substance, content: withBlocks(version, ...blocks) },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
    });
  /** Grace's suggestion on a version: a changed, and c added. */
  const suggest = async (version: StoredVersion, by = grace) => {
    const answer = await tenant((trx) =>
      makeSuggestion(trx, {
        component: version.artifactId,
        version: version.id,
        proposed: withBlocks(
          version,
          para('a', 'Unbox it carefully.'),
          para('b', 'Set the tray.'),
          para('c', 'Wait.'),
        ),
        by,
      }),
    );
    if (answer.answer !== 'made') throw new Error(answer.answer);
    return answer.suggestion;
  };
  const latest = (version: StoredVersion) =>
    tenant((trx) => latestVersion(trx, version.artifactId)).then((found) => found!);

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
    await tenant(async (trx) => {
      const person = (subject: string, name: string) =>
        trx
          .insertInto('principal')
          .values({ issuer: 'https://idp.example', subject, email: null, display_name: name })
          .returning('id')
          .executeTakeFirstOrThrow()
          .then((row) => row.id);
      ada = await person('ada', 'Ada');
      grace = await person('grace', 'Grace');
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('COL-020 COL-021 COL-025 keeps a draft beside a component its author holds, with who and when, and leaves the content as it was', async () => {
    const version = await component();
    await tenant((trx) =>
      claimLock(trx, { artifactId: version.artifactId, principal: ada, session: SESSION }),
    );
    const id = await suggest(version);
    const read = await tenant((trx) => readSuggestion(trx, id));
    expect(read).toMatchObject({
      component: version.artifactId,
      madeAgainst: version.id,
      madeBy: { id: grace, name: 'Grace' },
      resolution: null,
    });
    expect(read!.madeAt).toBeInstanceOf(Date);
    expect((await latest(version)).id).toBe(version.id);
    // The same draft sent again is the same suggestion; the version itself is no suggestion at all.
    expect(await suggest(version)).toBe(id);
    expect(
      await tenant((trx) =>
        makeSuggestion(trx, {
          component: version.artifactId,
          version: version.id,
          proposed: contentOf(version),
          by: grace,
        }),
      ),
    ).toEqual({ answer: 'suggestion.empty' });
  });

  it('COL-042 COL-041 refuses accepting or rejecting while another holds the component, and its holder while they hold saved work', async () => {
    const version = await component();
    const id = await suggest(version);
    await tenant((trx) =>
      claimLock(trx, { artifactId: version.artifactId, principal: ada, session: SESSION }),
    );
    for (const act of [acceptSuggestion, rejectSuggestion]) {
      expect(await tenant((trx) => act(trx, { suggestion: id, by: grace }))).toMatchObject({
        answer: 'lock.held',
        lock: { holder: ada, holderName: 'Ada' },
      });
    }
    await tenant((trx) =>
      saveIteration(trx, {
        artifactId: version.artifactId,
        principal: ada,
        session: SESSION,
        sequence: 1,
        openedFrom: version.id,
        content: withBlocks(version, para('a', 'Unbox it.'), para('b', 'Set the tray now.')),
      }),
    );
    expect(await tenant((trx) => acceptSuggestion(trx, { suggestion: id, by: ada }))).toEqual({
      answer: 'edits.pending',
    });
    expect((await tenant((trx) => readSuggestion(trx, id)))!.resolution).toBeNull();
  });

  it('COL-024 COL-043 accepts as a version by whoever accepts, applied over a version edited since, and audits it as theirs', async () => {
    const version = await component();
    const id = await suggest(version);
    // Ada adds d meanwhile.
    await revise(version, para('a', 'Unbox it.'), para('b', 'Set the tray.'), para('d', 'Done.'));
    const accepted = await tenant((trx) => acceptSuggestion(trx, { suggestion: id, by: ada }));
    expect(accepted).toMatchObject({ answer: 'accepted' });
    const now = await latest(version);
    expect(now.author).toBe(ada);
    // Grace's c follows b after what Ada added there since (ADR-0059).
    expect(contentOf(now).content.map((block) => block.id)).toEqual(['a', 'b', 'd', 'c']);
    expect((await tenant((trx) => readSuggestion(trx, id)))!.resolution).toMatchObject({
      act: 'accepted',
      by: { id: ada },
      version: now.id,
    });
    const event = await tenant((trx) =>
      trx
        .selectFrom('audit_event')
        .select(['detail'])
        .where('kind', '=', 'suggestion.accepted')
        .orderBy('sequence', 'desc')
        .executeTakeFirstOrThrow(),
    );
    expect(event.detail).toEqual({ suggestion: id, author: grace, version: now.id });
    expect(await tenant((trx) => rejectSuggestion(trx, { suggestion: id, by: ada }))).toEqual({
      answer: 'suggestion.resolved',
    });
  });

  it('COL-052 refuses a suggestion that no longer fits, saying where, and keeps it pending', async () => {
    const version = await component();
    const id = await suggest(version);
    await revise(version, para('a', 'Unbox it gently.'), para('b', 'Set the tray.'));
    expect(await tenant((trx) => acceptSuggestion(trx, { suggestion: id, by: ada }))).toEqual({
      answer: 'suggestion.stale',
      stale: [{ block: 'a', why: 'changed' }],
    });
    expect((await tenant((trx) => readSuggestion(trx, id)))!.resolution).toBeNull();
  });

  it('accepts a suggestion somebody already made by hand, standing in the current version', async () => {
    const version = await component();
    const id = await suggest(version);
    const byHand = await revise(
      version,
      para('a', 'Unbox it carefully.'),
      para('b', 'Set the tray.'),
      para('c', 'Wait.'),
    );
    expect(await tenant((trx) => acceptSuggestion(trx, { suggestion: id, by: ada }))).toMatchObject(
      {
        answer: 'accepted',
        version: { id: byHand.id },
      },
    );
  });

  it('COL-048 lets its author alone withdraw it, once, and keeps it', async () => {
    const version = await component();
    const id = await suggest(version);
    expect(await tenant((trx) => withdrawSuggestion(trx, { suggestion: id, by: ada }))).toEqual({
      answer: 'suggestion.not_yours',
    });
    expect(await tenant((trx) => withdrawSuggestion(trx, { suggestion: id, by: grace }))).toEqual({
      answer: 'withdrawn',
    });
    expect(await tenant((trx) => withdrawSuggestion(trx, { suggestion: id, by: grace }))).toEqual({
      answer: 'suggestion.resolved',
    });
    expect((await tenant((trx) => readSuggestion(trx, id)))!.resolution).toMatchObject({
      act: 'withdrawn',
      by: { id: grace },
    });
  });

  it('gives nobody a way to delete or change a suggestion or how it ended', async () => {
    const version = await component();
    const id = await suggest(version);
    await tenant((trx) => rejectSuggestion(trx, { suggestion: id, by: ada }));
    for (const statement of [
      sql`delete from suggestion_resolution where suggestion_id = ${id}`,
      sql`delete from suggestion where id = ${id}`,
      sql`update suggestion set proposed = '{}' where id = ${id}`,
    ]) {
      await expect(tenant((trx) => statement.execute(trx))).rejects.toThrow(/permission denied/);
    }
  });
});
