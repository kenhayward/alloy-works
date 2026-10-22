import { randomBytes } from 'node:crypto';
import {
  blockIdentifierFrom,
  type ContentDocument,
  type CslItem,
  type OutlineDocument,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeBaseline } from './baselines.js';
import {
  archiveEntry,
  createEntry,
  entriesForExport,
  entryUses,
  findEntryMatches,
  importEntries,
  listEntries,
  readEntry,
  recordEntryVersion,
  type StoredEntry,
} from './bibliography.js';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDocument } from './documents.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
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
import { recordVersion, substanceOf, type StoredVersion } from './versions.js';

const ISSUER = 'https://idp.example';

const dunnart: CslItem = {
  type: 'article-journal',
  title: 'The Dunnart in Winter',
  author: [{ family: 'Smith', given: 'Ada' }],
  issued: { 'date-parts': [[2020]] },
  DOI: '10.1234/dunnart.2020',
};

describe('a bibliography entry', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let general: string;
  let quality: string;

  const tenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const made = (csl: CslItem, spaceId = general, despiteMatches = false) =>
    tenant(async (trx) => {
      const answer = await createEntry(trx, {
        author: ada,
        spaceId,
        entry: { csl },
        despiteMatches,
      });
      if (answer.answer !== 'created') throw new Error(JSON.stringify(answer));
      return answer.entry;
    });

  /** A component in General citing the entry, at its second version. */
  const citing = (entry: string, title: string) =>
    tenant(async (trx) => {
      const first = await createComponent(trx, {
        spaceId: general,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (first.answer !== 'created') throw new Error(first.answer);
      const substance = substanceOf(first.version);
      if (substance.kind !== 'component') throw new Error('not a component');
      const content: ContentDocument = {
        ...substance.content,
        content: [
          {
            type: 'paragraph',
            id: 'p1',
            style: 'body',
            content: [
              { type: 'text', value: 'As shown ', marks: [] },
              { type: 'citation', entry, locator: 'p. 3' },
            ],
          },
        ] as ContentDocument['content'],
      };
      const next = await recordVersion(trx, {
        artifactId: first.version.artifactId,
        openedFrom: first.version.id,
        author: ada,
        substance: { ...substance, content },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
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
    await tenant(async (trx) => {
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
      // Ada is the Administrator of both; Grace reads Quality alone.
      const administrator = await findRole(trx, 'Administrator');
      const reader = await findRole(trx, 'Reader');
      for (const [role, principal, space] of [
        [administrator!.id, ada, general],
        [administrator!.id, ada, quality],
        [reader!.id, grace, quality],
      ] as const) {
        await grant(trx, {
          roleId: role,
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

  it('LIB-011 is made at 0.1 holding its CSL, where it was obtained and when checked, and read back', async () => {
    const answer = await tenant((trx) =>
      createEntry(trx, {
        author: ada,
        spaceId: quality,
        entry: {
          csl: { type: 'book', title: 'Bilbies of the Pilbara', ISBN: '0-306-40615-2' },
          obtained: { from: 'https://library.example/bilbies', at: '2026-10-01T09:00:00.000Z' },
          checkedAt: '2026-10-20T09:00:00.000Z',
        },
      }),
    );
    if (answer.answer !== 'created') throw new Error(answer.answer);
    const read = await tenant((trx) => readEntry(trx, answer.entry.id));
    expect(read?.entry).toEqual({
      schemaVersion: 1,
      csl: { type: 'book', title: 'Bilbies of the Pilbara', ISBN: '0-306-40615-2' },
      key: 'bilbies',
      obtained: { from: 'https://library.example/bilbies', at: '2026-10-01T09:00:00.000Z' },
      checkedAt: '2026-10-20T09:00:00.000Z',
    });
    expect(read?.space.name).toBe('Quality');
    expect(read?.version.revision).toBe(0);
    expect(read?.version.version).toBe(1);
  });

  it('LIB-008 refuses a field beyond CSL, and a type CSL does not hold, writing nothing', async () => {
    const answer = await tenant((trx) =>
      createEntry(trx, {
        author: ada,
        spaceId: general,
        entry: { csl: { ...dunnart, type: 'blog' } as unknown as CslItem },
      }),
    );
    expect(answer).toMatchObject({ answer: 'entry.refused', problems: [{ path: 'csl.type' }] });
  });

  it('LIB-046 keys an entry from its fields, suffixed where the space holds the key, and never changes it', async () => {
    const first = await made({ ...dunnart, DOI: '10.1234/key.1' });
    const second = await made({ ...dunnart, DOI: '10.1234/key.2', title: 'Dunnarts in Spring' });
    const elsewhere = await made({ ...dunnart, DOI: '10.1234/key.3' }, quality);
    expect([first.entry.key, second.entry.key, elsewhere.entry.key]).toEqual([
      'smith2020',
      'smith2020a',
      'smith2020',
    ]);
    // A later version keeps the key, though the fields would now make another.
    const answer = await tenant((trx) =>
      recordEntryVersion(trx, {
        author: ada,
        id: second.id,
        openedFrom: second.version.id,
        entry: { csl: { ...second.entry.csl, author: [{ family: 'Jones' }] } },
      }),
    );
    if (answer.answer !== 'recorded') throw new Error(answer.answer);
    expect(answer.entry.entry.key).toBe('smith2020a');
    expect(answer.entry.version.version).toBe(2);
  });

  it('LIB-044 offers the entry already in the space when one is made by hand, and makes it only when asked to despite it', async () => {
    const existing = await made({ ...dunnart, DOI: '10.1234/offer' });
    const offered = await tenant((trx) =>
      createEntry(trx, {
        author: ada,
        spaceId: general,
        entry: { csl: { ...dunnart, DOI: 'https://doi.org/10.1234/OFFER', title: 'Other' } },
      }),
    );
    expect(offered).toMatchObject({
      answer: 'matched',
      matches: [{ by: 'doi', entry: { id: existing.id, key: existing.entry.key } }],
    });
    const despite = await tenant((trx) =>
      createEntry(trx, {
        author: ada,
        spaceId: general,
        entry: { csl: { ...dunnart, DOI: '10.1234/offer' } },
        despiteMatches: true,
      }),
    );
    expect(despite).toMatchObject({
      answer: 'created',
      matches: [{ by: 'doi', entry: { id: existing.id } }],
    });
  });

  it('LIB-045 matches by canonical identifiers first, else by title, year and first author, saying which', async () => {
    const book = await made({ type: 'book', title: 'Quolls', ISBN: '978-1-56619-909-4' });
    const work = await made({
      type: 'article-journal',
      title: 'The Numbat, Revisited',
      author: [{ family: 'Okafor' }],
      issued: { 'date-parts': [[2019]] },
    });
    const matches = (csl: CslItem) =>
      tenant((trx) => findEntryMatches(trx, ada, general, csl)).then((found) =>
        found.map((each) => [each.by, each.entry.id]),
      );
    expect(await matches({ type: 'book', title: 'Other', ISBN: '1566199093' })).toEqual([
      ['isbn', book.id],
    ]);
    expect(
      await matches({
        type: 'article',
        title: 'the numbat revisited',
        author: [{ family: 'OKAFOR', given: 'Grace' }],
        issued: { 'date-parts': [[2019, 4]] },
      }),
    ).toEqual([['work', work.id]]);
    // A record with an identifier is matched by it alone; another space's entries are never matched.
    expect(
      await matches({
        type: 'article',
        title: 'The Numbat, Revisited',
        author: [{ family: 'Okafor' }],
        issued: { 'date-parts': [[2019]] },
        DOI: '10.1234/unseen',
      }),
    ).toEqual([]);
    expect(
      await tenant((trx) =>
        findEntryMatches(trx, ada, quality, { type: 'book', title: 'Quolls', ISBN: '1566199093' }),
      ),
    ).toEqual([]);
  });

  it('LIB-010 imports a record matching an entry into it, merging the fields it lacked and saying which', async () => {
    const existing = await made({
      type: 'article-journal',
      title: 'Bandicoot Burrows',
      DOI: '10.1234/bandicoot',
    });
    const done = await tenant((trx) =>
      importEntries(trx, {
        author: ada,
        spaceId: general,
        records: [
          {
            id: 'jones2018',
            type: 'article-journal',
            title: 'Bandicoot burrows',
            DOI: 'doi:10.1234/BANDICOOT',
            volume: '4',
            page: '10-12',
          },
          { id: 'x', type: 'book', title: 'Potoroos', custom: { shelf: 'B' } },
          // The same source twice in one import is made once.
          { id: 'y', type: 'book', title: 'Potoroos' },
          { id: 'z', title: 'No type at all' },
        ],
      }),
    );
    expect(
      done?.map((each) =>
        each.outcome === 'refused'
          ? [each.outcome, each.dropped]
          : each.outcome === 'merged'
            ? [each.outcome, each.entry.id === existing.id, each.by, each.merged, each.dropped]
            : [each.outcome, each.entry.entry.key, each.dropped],
      ),
    ).toEqual([
      ['merged', true, 'doi', ['page', 'volume'], []],
      ['created', 'potoroos', ['custom']],
      ['merged', false, 'work', [], []],
      ['refused', []],
    ]);
    const merged = await tenant((trx) => readEntry(trx, existing.id));
    expect(merged?.entry.csl).toMatchObject({ title: 'Bandicoot Burrows', volume: '4' });
    expect(merged?.version.version).toBe(2);
  });

  it('LIB-009 lists and exports the entries a reader may read, by key', async () => {
    const listed = await tenant((trx) => listEntries(trx, grace, quality));
    expect(listed?.items.map((each) => each.key)).toEqual(['bilbies', 'smith2020']);
    expect(listed?.total).toBe(2);
    expect(await tenant((trx) => listEntries(trx, grace, general)).then((l) => l?.total)).toBe(0);
    const exported = await tenant((trx) => entriesForExport(trx, grace, quality));
    expect(exported?.map((each) => [each.key, each.csl.title])).toEqual([
      ['bilbies', 'Bilbies of the Pilbara'],
      ['smith2020', 'The Dunnart in Winter'],
    ]);
  });

  it("lists where it is cited, a component's latest version and a baseline's pin, and is kept from archiving while it is", async () => {
    const entry: StoredEntry = await made({
      type: 'book',
      title: 'Wombat Ways',
      ISBN: '978-0-306-40615-7',
    });
    const cites = await citing(entry.id, 'The wombat section');
    expect(await tenant((trx) => entryUses(trx, ada, entry.id))).toEqual({
      components: {
        named: [{ id: cites.artifactId, title: 'The wombat section' }],
        unreadable: false,
      },
      baselines: { named: [], unreadable: false },
    });
    // Grace reads none of General: the use is said to exist, never named.
    expect((await tenant((trx) => entryUses(trx, grace, entry.id))).components).toEqual({
      named: [],
      unreadable: true,
    });
    expect(await tenant((trx) => archiveEntry(trx, entry.id, ada, 'archived'))).toBe('cited');

    // A baseline pins the citing version; the component then cites it no longer.
    const document = await tenant(async (trx) => {
      const created = await createDocument(trx, {
        spaceId: general,
        title: 'The wombat report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (created.answer !== 'created') throw new Error(created.answer);
      const outline: OutlineDocument = {
        ...(created.version.content as OutlineDocument),
        nodes: [
          {
            type: 'reference',
            id: blockIdentifierFrom(randomBytes(16)),
            component: cites.artifactId,
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
        artifactId: created.version.artifactId,
        openedFrom: created.version.id,
        author: ada,
        substance: { kind: 'document', content: outline },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version;
    });
    const baseline = await tenant((trx) =>
      makeBaseline(trx, {
        documentId: document.artifactId,
        version: document.id,
        name: 'Issued',
        maker: ada,
      }),
    );
    if (baseline.answer !== 'made') throw new Error(JSON.stringify(baseline));
    await uncite(cites);
    const uses = await tenant((trx) => entryUses(trx, ada, entry.id));
    expect(uses.components.named).toEqual([]);
    expect(uses.baselines.named).toEqual([
      { id: baseline.baseline, name: 'Issued', document: document.artifactId },
    ]);
    expect(await tenant((trx) => archiveEntry(trx, entry.id, ada, 'archived'))).toBe('cited');

    // An entry nothing cites is archived, and leaves the listing.
    const free = await made({ type: 'book', title: 'Echidnas', ISBN: '978-3-16-148410-0' });
    expect(await tenant((trx) => archiveEntry(trx, free.id, ada, 'archived'))).toBe('changed');
    expect((await tenant((trx) => readEntry(trx, free.id)))?.archived).toBe(true);
    const keys = await tenant((trx) => listEntries(trx, ada, general)).then((listed) =>
      listed?.items.map((each) => each.key),
    );
    expect(keys).not.toContain('echidnas');
    expect(keys).toContain('wombat');
  });

  /** The component's next version, citing nothing. */
  const uncite = (from: StoredVersion) =>
    tenant(async (trx) => {
      const substance = substanceOf(from);
      if (substance.kind !== 'component') throw new Error('not a component');
      const next = await recordVersion(trx, {
        artifactId: from.artifactId,
        openedFrom: from.id,
        author: ada,
        substance: {
          ...substance,
          content: {
            ...substance.content,
            content: [
              {
                type: 'paragraph',
                id: 'p1',
                style: 'body',
                content: [{ type: 'text', value: 'As shown.', marks: [] }],
              },
            ] as ContentDocument['content'],
          },
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
    });
});
