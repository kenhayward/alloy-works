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
import { installExtension } from './extensions.js';
import {
  attemptEntryCheck,
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
  queryAs,
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
  let hedy: string;
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
      // Hedy holds no grant: an owner since moved on, who may no longer read.
      hedy = await person(trx, 'hedy', 'Hedy');
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

  it("LIB-036 tells the document's review owner of an entry's outcome once in thirty days, however often it flaps", async () => {
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
    // Corrected is another outcome; current tells nobody, and a flap back within thirty days nobody.
    expect((await record(entry, checked('corrected'))).told).toEqual([grace]);
    expect((await record(entry, checked('current'))).told).toEqual([]);
    expect((await record(entry, checked('retracted'))).told).toEqual([]);
    expect((await told()).length - before).toBe(2);
    // Thirty days on, told again.
    await tenant((trx) =>
      sql`update bibliography_entry_told set told_at = now() - interval '31 days'
           where entry_id = ${entry} and outcome = 'retracted'`.execute(trx),
    );
    expect((await record(entry, checked('current'))).told).toEqual([]);
    expect((await record(entry, checked('retracted'))).told).toEqual([grace]);
  });

  it('LIB-036 never tells a former owner who may no longer read the document, but its maker', async () => {
    const entry = await made({ ...marsh, title: 'Former owner' }, 'crossref:10.5555/former.1');
    const component = await citing([entry], 'Former section');
    const document = await placing([component], 'Former report', grace);
    await tenant((trx) =>
      setDates(trx, {
        artifactId: document,
        kind: 'document',
        effective: null,
        reviewBy: null,
        owner: hedy,
        by: ada,
      }),
    );
    expect((await record(entry, checked('retracted'))).told).toEqual([grace]);
  });

  it('tells nobody twice when two checks of an entry race', async () => {
    const entry = await made({ ...marsh, title: 'Raced' }, 'crossref:10.5555/raced.1');
    const component = await citing([entry], 'Raced section');
    await placing([component], 'Raced report', grace);
    // The first check tells Grace and holds its transaction open; the second must wait for it.
    let release!: () => void;
    let held!: (told: readonly string[]) => void;
    const first = new Promise<readonly string[]>((done) => (held = done));
    const finished = tenant(async (trx) => {
      held(
        (
          await recordEntryCheck(trx, {
            entryId: entry,
            source: 'crossref',
            check: checked('retracted'),
          })
        ).told,
      );
      await new Promise<void>((done) => (release = done));
    });
    expect(await first).toEqual([grace]);
    const second = record(entry, checked('retracted'));
    for (let tries = 0; ; tries += 1) {
      const { rows } = await queryAs(
        db.adminUrl,
        `select count(*)::int as waiting from pg_locks where not granted
            and pid in (select pid from pg_stat_activity where datname = current_database())`,
      );
      if ((rows[0] as { waiting: number }).waiting > 0) break;
      if (tries > 200) throw new Error('The second check never waited');
      await new Promise((settle) => setTimeout(settle, 10));
    }
    release();
    await finished;
    expect((await second).told).toEqual([]);
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

  it('takes the entries due per source, each by its last attempt, so a source that keeps failing crowds out none', async () => {
    const first = await made({ ...marsh, title: 'Attempted first' }, 'crossref:10.5555/att.1');
    const second = await made({ ...marsh, title: 'Attempted second' }, 'crossref:10.5555/att.2');
    const dunnart = await made({ ...marsh, title: 'Dunnart' }, 'pubmed:99000077');
    await citing([first, second, dunnart], 'Attempted section');
    // Every entry attempted, these last: an attempt with no answer still goes to the back.
    await tenant(async (trx) => {
      const { rows } = await sql<{ id: string }>`
        select id from artifact where kind = 'bibliographyEntry'`.execute(trx);
      for (const { id } of rows) await attemptEntryCheck(trx, id);
    });
    await tenant((trx) =>
      sql`update bibliography_entry_attempt set last_attempt_at = now() + interval '1 hour'
           where entry_id = ${first}`.execute(trx),
    );
    const ids = (await tenant((trx) => entriesDue(trx, 100))).map((each) => each.entryId);
    expect(ids.indexOf(second)).toBeLessThan(ids.indexOf(first));
    // One each from Crossref and PubMed, however many Crossref has waiting.
    const one = await tenant((trx) => entriesDue(trx, 1));
    expect(one.map((each) => each.source).sort()).toEqual(['crossref', 'pubmed']);
  });

  it('records an attempt at most once a minute where asked to, and always for the sweep', async () => {
    const entry = await made({ ...marsh, title: 'Once a minute' }, 'crossref:10.5555/minute.1');
    expect(await tenant((trx) => attemptEntryCheck(trx, entry, 60))).toBe(true);
    expect(await tenant((trx) => attemptEntryCheck(trx, entry, 60))).toBe(false);
    expect(await tenant((trx) => attemptEntryCheck(trx, entry))).toBe(true);
    await tenant((trx) =>
      sql`update bibliography_entry_attempt set last_attempt_at = now() - interval '61 seconds'
           where entry_id = ${entry}`.execute(trx),
    );
    expect(await tenant((trx) => attemptEntryCheck(trx, entry, 60))).toBe(true);
  });

  it('LIB-032 finds an entry a reference extension obtained, with where it is reached, and records its check by its key', async () => {
    const herbarium = await tenant((trx) =>
      installExtension(trx, {
        url: 'https://herbarium.example.test/manifest.json',
        digest: 'c'.repeat(64),
        manifest: {
          manifest: 1,
          name: 'Herbarium records',
          version: '0.3.0',
          publisher: 'Invented Herbarium',
          description: 'Specimen papers by catalogue number.',
          kind: 'reference',
          endpoint: 'https://herbarium.example.test/alloy',
          reference: { search: '/search', fetch: '/records' },
          authentication: 'none',
          outbound: [],
        },
        by: ada,
      }),
    );
    const key = `ext:${herbarium.id}` as const;
    const saltbush = await made({ ...marsh, title: 'Saltbush' }, `${key}:HERB-0042`);
    await citing([saltbush], 'Herbarium section');
    const due = await tenant((trx) => entriesDue(trx, 100));
    expect(due.find((each) => each.entryId === saltbush)).toMatchObject({
      source: key,
      identifier: 'HERB-0042',
      extension: {
        endpoint: 'https://herbarium.example.test/alloy',
        search: '/search',
        fetch: '/records',
      },
    });
    expect(await tenant((trx) => entryCheckable(trx, saltbush))).toMatchObject({ source: key });
    const { status } = await tenant((trx) =>
      recordEntryCheck(trx, { entryId: saltbush, source: key, check: checked('current') }),
    );
    expect(status.source).toBe(key);
    await tenant((trx) => setReferenceSource(trx, key, false));
    expect((await tenant((trx) => entriesDue(trx, 100))).map((each) => each.entryId)).not.toContain(
      saltbush,
    );
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

  it('LIB-035 records an entry superseded, flags it on each citation and tells the owner, and the gate counts it not', async () => {
    const entry = await made({ ...marsh, title: 'Superseded' }, 'crossref:10.5555/s.1');
    const component = await citing([entry], 'Superseded section');
    const document = await placing([component], 'Superseded report', grace);
    const notice = { kind: 'supersession' as const, identifier: '10.5555/s.1.v2' };
    const before = (await told()).length;
    expect((await record(entry, checked('superseded', { notice }))).told).toEqual([grace]);
    expect((await told()).slice(before)).toEqual([
      { recipient: grace, artifact_id: document, counts: { entry, outcome: 'superseded' } },
    ]);
    expect(await tenant((trx) => readEntryStatus(trx, entry))).toMatchObject({
      outcome: 'superseded',
      notice,
    });
    expect(await tenant((trx) => citedFlags(trx, [entry]))).toEqual(
      new Map([[entry, 'superseded']]),
    );
    expect(await tenant(async (trx) => flaggedCited(trx, await placedBy(trx, document)))).toEqual([
      { entry, outcome: 'superseded', components: [component] },
    ]);
    expect(
      await tenant((trx) =>
        unmetConditions(trx, {
          artifactId: document,
          kind: 'document',
          requires: ['noRetracted'],
          principal: grace,
        }),
      ),
    ).toEqual([]);
  });
});
