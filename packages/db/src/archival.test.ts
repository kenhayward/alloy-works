import { randomBytes, randomUUID } from 'node:crypto';
import {
  blockIdentifierFrom,
  type ContentDocument,
  type OutlineDocument,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { archiveArtifact, isArchived, unarchiveArtifact } from './archival.js';
import { whatWaits } from './attention.js';
import { bootstrapCluster } from './bootstrap.js';
import { listReadableComponents } from './components.js';
import { createComponent } from './creation.js';
import { createDocument, listReadableDocuments, readableComponents } from './documents.js';
import { claimLock, saveIteration } from './editing.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { failPublicationRequest, requestPublication } from './publishing.js';
import { findRole } from './roles.js';
import { searchWords } from './search-words.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { latestVersion, recordVersion } from './versions.js';

const ISSUER = 'https://idp.example';

describe('archiving a component or a document (lifecycle.md; the AH plan, AH-B to AH-E)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  /** A space of its own, with Ada an Author and Publisher on it. */
  const fresh = () =>
    as(async (trx) => {
      const space = (await createSpace(trx, `Space ${randomUUID()}`)).id;
      const ada = (
        await trx
          .insertInto('principal')
          .values({ issuer: ISSUER, subject: randomUUID(), email: null, display_name: 'Ada' })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      for (const name of ['Author', 'Publisher']) {
        await grant(trx, {
          roleId: (await findRole(trx, name))!.id,
          subject: { principal: ada },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        });
      }
      return { space, ada };
    });

  const component = (space: string, author: string, title: string) =>
    as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version.artifactId;
    });

  const document = (space: string, author: string, title: string) =>
    as(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version.artifactId;
    });

  const archive = (id: string, by: string) => as((trx) => archiveArtifact(trx, id, by));
  const unarchive = (id: string, by: string) => as((trx) => unarchiveArtifact(trx, id, by));

  const components = (ada: string, space: string, archived?: 'only') =>
    as(async (trx) => {
      const page = await listReadableComponents(
        trx,
        ada,
        { limit: 50 },
        { spaces: [space], ...(archived ? { archived } : {}) },
      );
      return page!;
    });

  const documents = (ada: string, space: string, archived?: 'only') =>
    as(async (trx) => {
      const page = await listReadableDocuments(
        trx,
        ada,
        { limit: 50 },
        { spaces: [space], ...(archived ? { archived } : {}) },
      );
      return page!;
    });

  const found = (ada: string, words: string) =>
    as(async (trx) => {
      const answer = await searchWords(trx, ada, words);
      if (answer?.outcome !== 'results') throw new Error(answer?.outcome);
      return answer;
    });

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('LIF-020 leaves the component listing, its facets and its total while archived, and comes back on unarchive', async () => {
    const { space, ada } = await fresh();
    const kept = await component(space, ada, 'Kept procedure');
    const shelved = await component(space, ada, 'Shelved procedure');

    expect(await archive(shelved, ada)).toBe('changed');
    const listed = await components(ada, space);
    expect(listed.items.map((each) => each.id)).toEqual([kept]);
    expect(listed.total).toBe(1);
    expect(listed.facets.spaces.map((each) => each.count)).toEqual([1]);
    // The one way to list it: only what is archived, still readable-filtered.
    const only = await components(ada, space, 'only');
    expect(only.items.map((each) => each.id)).toEqual([shelved]);
    expect(only.total).toBe(1);

    expect(await unarchive(shelved, ada)).toBe('changed');
    expect((await components(ada, space)).items.map((each) => each.id).sort()).toEqual(
      [kept, shelved].sort(),
    );
    expect((await components(ada, space, 'only')).items).toEqual([]);
  });

  it('LIF-020 leaves the document listing and its facets while archived, and comes back on unarchive', async () => {
    const { space, ada } = await fresh();
    const kept = await document(space, ada, 'Kept manual');
    const shelved = await document(space, ada, 'Shelved manual');

    await archive(shelved, ada);
    const listed = await documents(ada, space);
    expect(listed.items.map((each) => each.id)).toEqual([kept]);
    expect(listed.total).toBe(1);
    expect(listed.facets.publishing.reduce((sum, each) => sum + each.count, 0)).toBe(1);
    expect((await documents(ada, space, 'only')).items.map((each) => each.id)).toEqual([shelved]);

    await unarchive(shelved, ada);
    expect((await documents(ada, space)).total).toBe(2);
  });

  it('LIF-020 leaves search, its sections and its counts while archived, and an edit does not bring it back', async () => {
    const { space, ada } = await fresh();
    const word = `zephyr${randomUUID().slice(0, 8)}`;
    const shelved = await component(space, ada, `Shelved ${word}`);
    const manual = await document(space, ada, `Manual ${word}`);
    expect((await found(ada, word)).count).toBe(2);

    await archive(shelved, ada);
    await archive(manual, ada);
    const hidden = await found(ada, word);
    expect(hidden.items).toEqual([]);
    expect(hidden.count).toBe(0);

    // An edit re-indexes the component from its new version; archived, it stays out of search.
    await as(async (trx) => {
      const latest = (await latestVersion(trx, shelved))!;
      const recorded = await recordVersion(trx, {
        artifactId: shelved,
        openedFrom: latest.id,
        author: ada,
        substance: {
          kind: 'component',
          content: { ...(latest.content as ContentDocument), title: `Edited ${word}` },
          values: latest.values,
          notCarried: [],
          definitions: latest.definitions,
        },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
    });
    expect((await found(ada, word)).count).toBe(0);

    await unarchive(shelved, ada);
    await unarchive(manual, ada);
    expect((await found(ada, word)).items.map((each) => each.artifactId).sort()).toEqual(
      [shelved, manual].sort(),
    );
  });

  it("LIF-020 leaves Home's attention while archived, and comes back on unarchive", async () => {
    const { space, ada } = await fresh();
    const manual = await document(space, ada, 'Failing manual');
    await as(async (trx) => {
      const latest = (await latestVersion(trx, manual))!;
      const asked = await requestPublication(trx, {
        documentId: manual,
        version: latest.id,
        formats: ['pdf'],
        requester: ada,
      });
      if (asked.answer !== 'requested') throw new Error(asked.answer);
      await failPublicationRequest(trx, asked.request.id, [
        { stage: 'engine', code: 'engine_failed', node: null, block: null, detail: null },
      ]);
    });
    const shelved = await component(space, ada, 'Unsaved procedure');
    await as(async (trx) => {
      const latest = (await latestVersion(trx, shelved))!;
      const editing = { artifactId: shelved, principal: ada, session: randomUUID() };
      const claimed = await claimLock(trx, { ...editing, move: true });
      if (claimed.answer !== 'claimed') throw new Error(claimed.answer);
      const saved = await saveIteration(trx, {
        ...editing,
        sequence: 1,
        openedFrom: latest.id,
        content: { ...(latest.content as ContentDocument), title: 'Unsaved procedure, changed' },
      });
      if (saved.answer !== 'accepted') throw new Error(saved.answer);
    });
    const waiting = async () =>
      (await as((trx) => whatWaits(trx, ada))).items.map((each) => each.artifact.id).sort();
    expect(await waiting()).toEqual([manual, shelved].sort());

    await archive(manual, ada);
    await archive(shelved, ada);
    expect(await as((trx) => whatWaits(trx, ada))).toEqual({ items: [], total: 0 });

    await unarchive(manual, ada);
    await unarchive(shelved, ada);
    expect(await waiting()).toEqual([manual, shelved].sort());
  });

  it('LIF-020 pages a walk as its first page found it, across an archive made during it', async () => {
    const { space, ada } = await fresh();
    for (const title of ['A one', 'B two', 'C three']) await component(space, ada, title);
    const first = await as((trx) =>
      listReadableComponents(trx, ada, { limit: 1 }, { spaces: [space] }),
    );
    const rest = (await components(ada, space)).items.slice(1).map((each) => each.id);
    await archive(rest[1]!, ada);
    const second = await as((trx) =>
      listReadableComponents(
        trx,
        ada,
        { limit: 50, snapshot: first!.snapshot, after: first!.next! },
        { spaces: [space] },
      ),
    );
    // The walk began before the archive, so it sees all three; a new walk sees two.
    expect(second!.items.map((each) => each.id)).toEqual(rest);
    expect(second!.total).toBe(3);
    expect((await components(ada, space)).total).toBe(2);
  });

  it('LIF-020 keeps it retrievable: a reference to it resolves, and it reads as before', async () => {
    const { space, ada } = await fresh();
    const shelved = await component(space, ada, 'Referenced procedure');
    const manual = await document(space, ada, 'Archived manual');
    // The manual places the component, by reference to its latest version.
    const node = blockIdentifierFrom(randomBytes(16));
    const placed = await as(async (trx) => {
      const opened = (await latestVersion(trx, manual))!;
      const outline: OutlineDocument = {
        ...(opened.content as OutlineDocument),
        nodes: [
          {
            type: 'reference',
            id: node,
            component: shelved,
            mode: { kind: 'latest' },
            numbered: true,
            matter: 'body',
            pageBreak: 'none',
            values: {},
            children: [],
          },
        ],
      };
      const recorded = await recordVersion(trx, {
        artifactId: manual,
        openedFrom: opened.id,
        author: ada,
        substance: { kind: 'document', content: outline },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version.id;
    });
    await archive(shelved, ada);
    await archive(manual, ada);
    expect(await as((trx) => readableComponents(trx, ada, [shelved]))).toEqual(new Set([shelved]));
    const latest = (await as((trx) => latestVersion(trx, shelved)))!;
    expect(latest.artifactId).toBe(shelved);
    const occurrences = await as(async (trx) => {
      const asked = await requestPublication(trx, {
        documentId: manual,
        version: placed,
        formats: ['pdf'],
        requester: ada,
      });
      if (asked.answer !== 'requested') throw new Error(asked.answer);
      return trx
        .selectFrom('publication_request_occurrence')
        .select(['node', 'version_id'])
        .where('request_id', '=', asked.request.id)
        .execute();
    });
    expect(occurrences).toEqual([{ node, version_id: latest.id }]);
  });

  it('LIF-057 records artifact.archived and artifact.unarchived about it, and archiving the archived changes nothing', async () => {
    const { space, ada } = await fresh();
    const shelved = await component(space, ada, 'Audited procedure');
    expect(await archive(shelved, ada)).toBe('changed');
    expect(await archive(shelved, ada)).toBe('unchanged');
    expect(await as((trx) => isArchived(trx, shelved))).toBe(true);
    expect(await unarchive(shelved, ada)).toBe('changed');
    expect(await unarchive(shelved, ada)).toBe('unchanged');
    const events = await as(async (trx) => {
      const { rows } = await sql<{ kind: string; subject_kind: string; space: string }>`
        select kind, subject_kind, space from audit_event where subject = ${shelved}
          and kind like 'artifact.%' order by sequence`.execute(trx);
      return rows;
    });
    expect(events).toEqual([
      { kind: 'artifact.archived', subject_kind: 'component', space },
      { kind: 'artifact.unarchived', subject_kind: 'component', space },
    ]);
    const acts = await as((trx) =>
      trx
        .selectFrom('artifact_archival')
        .select(['act', 'by'])
        .where('artifact_id', '=', shelved)
        .orderBy('id')
        .execute(),
    );
    expect(acts).toEqual([
      { act: 'archived', by: ada },
      { act: 'unarchived', by: ada },
    ]);
  });

  it('refuses at the store an act equal to the one before it, and anything but a component or a document', async () => {
    const { space, ada } = await fresh();
    const shelved = await component(space, ada, 'Guarded procedure');
    await archive(shelved, ada);
    await expect(
      as((trx) =>
        trx
          .insertInto('artifact_archival')
          .values({ artifact_id: shelved, kind: 'component', act: 'archived', by: ada })
          .execute(),
      ),
    ).rejects.toThrow(/artifact_archival/);
    await expect(
      as((trx) => sql`update artifact_archival set act = 'unarchived'`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    expect(await as((trx) => archiveArtifact(trx, space, ada))).toBeUndefined();
  });

  it('two archives at once record one act between them', async () => {
    const { space, ada } = await fresh();
    const shelved = await component(space, ada, 'Raced procedure');
    const answers = await Promise.all([archive(shelved, ada), archive(shelved, ada)]);
    expect(answers.sort()).toEqual(['changed', 'unchanged']);
    const acts = await as((trx) =>
      trx
        .selectFrom('artifact_archival')
        .select('act')
        .where('artifact_id', '=', shelved)
        .execute(),
    );
    expect(acts).toHaveLength(1);
  });
});
