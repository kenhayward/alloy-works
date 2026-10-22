import { randomBytes } from 'node:crypto';
import {
  blockIdentifierFrom,
  type ContentDocument,
  type CslItem,
  type EntryCheck,
  type OutlineDocument,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEntry } from './bibliography.js';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { setDates } from './dates.js';
import { createDocument } from './documents.js';
import {
  citedFlags,
  entriesDue,
  entryCheckable,
  flaggedCited,
  placedBy,
  readEntryStatus,
  recordEntryCheck,
} from './entry-status.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { setReferenceSource } from './reference-sources.js';
import { findRole } from './roles.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { recordVersion, substanceOf } from './versions.js';
import { unmetConditions } from './workflow-conditions.js';

const ISSUER = 'https://idp.example';

const marsh: CslItem = {
  type: 'article-journal',
  title: 'Salt Marsh Accretion Under Rising Tides',
  author: [{ family: 'Marlow', given: 'Ada' }],
  issued: { 'date-parts': [[2021, 3]] },
  DOI: '10.5555/marsh.2021.017',
};

const checked = (outcome: EntryCheck['outcome'], extra: Partial<EntryCheck> = {}): EntryCheck => ({
  outcome,
  differs: [],
  notice: outcome === 'retracted' ? { kind: 'retraction', identifier: '10.5555/r' } : null,
  ...extra,
});

describe("an entry's status from its source (the XR plan, XR-E to XR-H)", () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let ivy: string;
  let general: string;

  const tenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const made = (csl: CslItem, from?: string) =>
    tenant(async (trx) => {
      const answer = await createEntry(trx, {
        author: ada,
        spaceId: general,
        entry: {
          csl,
          ...(from === undefined ? {} : { obtained: { from, at: '2026-01-02T03:04:05Z' } }),
        },
        despiteMatches: true,
      });
      if (answer.answer !== 'created') throw new Error(JSON.stringify(answer));
      return answer.entry.id;
    });

  /** A component citing each entry, at its second version. */
  const citing = (entries: readonly string[], title: string) =>
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
              ...entries.map((entry) => ({ type: 'citation', entry })),
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
      return next.version.artifactId;
    });

  /** A document by `author` placing each component at its latest. */
  const placing = (components: readonly string[], title: string, author = ada) =>
    tenant(async (trx) => {
      const created = await createDocument(trx, {
        spaceId: general,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author,
      });
      if (created.answer !== 'created') throw new Error(created.answer);
      const outline: OutlineDocument = {
        ...(created.version.content as OutlineDocument),
        nodes: components.map((component) => ({
          type: 'reference' as const,
          id: blockIdentifierFrom(randomBytes(16)),
          component,
          mode: { kind: 'latest' as const },
          numbered: true,
          matter: 'body' as const,
          pageBreak: 'none' as const,
          values: {},
          children: [],
        })),
      };
      const recorded = await recordVersion(trx, {
        artifactId: created.version.artifactId,
        openedFrom: created.version.id,
        author,
        substance: { kind: 'document', content: outline },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version.artifactId;
    });

  const told = () =>
    tenant(async (trx) => {
      const { rows } = await sql<{
        recipient: string;
        artifact_id: string;
        counts: unknown;
      }>`select recipient, artifact_id, counts from notification where kind = 'reference'
          order by at, id`.execute(trx);
      return rows;
    });

  const record = (entryId: string, check: EntryCheck) =>
    tenant((trx) => recordEntryCheck(trx, { entryId, source: 'crossref', check }));

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
      ivy = await person(trx, 'ivy', 'Ivy');
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      // Ada administers General; Grace and Ivy author in it.
      const administrator = await findRole(trx, 'Administrator');
      const author = await findRole(trx, 'Author');
      for (const [role, principal] of [
        [administrator!.id, ada],
        [author!.id, grace],
        [author!.id, ivy],
      ] as const) {
        await grant(trx, {
          roleId: role,
          subject: { principal },
          level: { kind: 'space', id: general },
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

  it('LIB-036 records a check beside the entry, never as a version, and reads it back', async () => {
    const entry = await made(marsh, 'crossref:10.5555/marsh.2021.017');
    expect(await tenant((trx) => readEntryStatus(trx, entry))).toBeUndefined();
    await record(entry, checked('changed', { differs: ['title'] }));
    const status = await tenant((trx) => readEntryStatus(trx, entry));
    expect(status).toMatchObject({
      source: 'crossref',
      outcome: 'changed',
      differs: ['title'],
      notice: null,
    });
    expect(status?.checkedAt).toBeInstanceOf(Date);
    await record(entry, checked('retracted'));
    expect(await tenant((trx) => readEntryStatus(trx, entry))).toMatchObject({
      outcome: 'retracted',
      notice: { kind: 'retraction', identifier: '10.5555/r' },
    });
    const versions = await tenant((trx) =>
      trx.selectFrom('artifact_version').select('id').where('artifact_id', '=', entry).execute(),
    );
    expect(versions).toHaveLength(1);
    // Where it was obtained, read back as a source and identifier; one made by hand has none.
    expect(await tenant((trx) => entryCheckable(trx, entry))).toMatchObject({
      source: 'crossref',
      identifier: '10.5555/marsh.2021.017',
      csl: { title: marsh.title },
    });
    const byHand = await made({ type: 'book', title: 'By Hand' });
    expect(await tenant((trx) => entryCheckable(trx, byHand))).toBeUndefined();
  });

  it("LIB-036 tells the document's review owner once per entry, outcome and person, and again after it turned current", async () => {
    const entry = await made({ ...marsh, title: 'Owner told' }, 'crossref:10.5555/owner.1');
    const component = await citing([entry], 'Owned section');
    const document = await placing([component], 'Owned report');
    await tenant((trx) =>
      setDates(trx, {
        artifactId: document,
        kind: 'document',
        effective: null,
        reviewBy: null,
        owner: grace,
        by: ada,
      }),
    );
    const before = (await told()).length;
    expect((await record(entry, checked('retracted'))).told).toEqual([grace]);
    expect((await told()).slice(before)).toEqual([
      { recipient: grace, artifact_id: document, counts: { entry, outcome: 'retracted' } },
    ]);
    // The same outcome again tells nobody.
    expect((await record(entry, checked('retracted'))).told).toEqual([]);
    // Corrected is another outcome; current tells nobody and forgets who was told.
    expect((await record(entry, checked('corrected'))).told).toEqual([grace]);
    expect((await record(entry, checked('current'))).told).toEqual([]);
    expect((await record(entry, checked('retracted'))).told).toEqual([grace]);
    expect((await told()).length - before).toBe(3);
  });

  it("LIB-036 tells the document's maker where it has no owner, else the space's administrators, skipping the erased", async () => {
    const entry = await made({ ...marsh, title: 'Maker told' }, 'crossref:10.5555/maker.1');
    const component = await citing([entry], 'Made section');
    await placing([component], 'Grace report', grace);
    await placing([component], 'Ivy report', ivy);
    // Erased as erasure leaves a person, whose drafts keep a full erasure refused here.
    await tenant((trx) =>
      trx.updateTable('principal').set({ erased_at: new Date() }).where('id', '=', ivy).execute(),
    );
    // Grace made one; Ivy, erased, made the other, so General's administrator is told of it.
    expect([...(await record(entry, checked('corrected'))).told].sort()).toEqual(
      [ada, grace].sort(),
    );
  });

  it('finds the entries a latest version cites, from a source switched on, oldest check first', async () => {
    const fresh = await made({ ...marsh, title: 'Never checked' }, 'pubmed:99000001');
    const old = await made({ ...marsh, title: 'Checked long ago' }, 'crossref:10.5555/old.1');
    const uncited = await made({ ...marsh, title: 'Uncited' }, 'crossref:10.5555/uncited.1');
    const byHand = await made({ type: 'book', title: 'Cited by hand' });
    await citing([fresh, old, byHand], 'Due section');
    await record(old, checked('current'));
    await tenant((trx) =>
      sql`update bibliography_entry_status set checked_at = now() - interval '9 days'
           where entry_id = ${old}`.execute(trx),
    );
    const due = await tenant((trx) => entriesDue(trx, 100));
    const ids = due.map((each) => each.entryId);
    // Never checked first (obtained before 0150, say), then by when it was.
    expect(ids.indexOf(fresh)).toBeLessThan(ids.indexOf(old));
    expect(ids).not.toContain(uncited);
    expect(ids).not.toContain(byHand);
    expect(due.find((each) => each.entryId === fresh)).toMatchObject({
      source: 'pubmed',
      identifier: '99000001',
    });
    await tenant((trx) => setReferenceSource(trx, 'pubmed', false));
    const on = await tenant((trx) => entriesDue(trx, 100));
    await tenant((trx) => setReferenceSource(trx, 'pubmed', true));
    expect(on.map((each) => each.entryId)).not.toContain(fresh);
  });

  it('LIB-036 flags each cited entry retracted or corrected, and counts the retracted the document places for its gate', async () => {
    const retracted = await made({ ...marsh, title: 'Gate retracted' }, 'crossref:10.5555/g.1');
    const corrected = await made({ ...marsh, title: 'Gate corrected' }, 'crossref:10.5555/g.2');
    const current = await made({ ...marsh, title: 'Gate current' }, 'crossref:10.5555/g.3');
    const component = await citing([retracted, corrected, current], 'Gate section');
    const document = await placing([component], 'Gate report');
    const gate = () =>
      tenant((trx) =>
        unmetConditions(trx, {
          artifactId: document,
          kind: 'document',
          requires: ['noRetracted'],
          principal: grace,
        }),
      );
    expect(await gate()).toEqual([]);
    await record(retracted, checked('retracted'));
    await record(corrected, checked('corrected'));
    await record(current, checked('current'));
    expect(
      await tenant((trx) => citedFlags(trx, [retracted, corrected, current, 'nothing'])),
    ).toEqual(
      new Map([
        [retracted, 'retracted'],
        [corrected, 'corrected'],
      ]),
    );
    const flagged = await tenant(async (trx) => flaggedCited(trx, await placedBy(trx, document)));
    expect(flagged).toEqual(
      expect.arrayContaining([
        { entry: retracted, outcome: 'retracted', components: [component] },
        { entry: corrected, outcome: 'corrected', components: [component] },
      ]),
    );
    expect(flagged).toHaveLength(2);
    // Only the retracted counts; a correction warns elsewhere.
    expect(await gate()).toEqual([
      { condition: 'noRetracted', count: 1, names: [], unreadable: 0 },
    ]);
  });
});
