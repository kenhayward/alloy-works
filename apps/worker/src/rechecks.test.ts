import {
  createComponent,
  createDocument,
  createEntry,
  createTenant,
  findRole,
  grant,
  migrate,
  prepareDatabase,
  readEntryStatus,
  recordVersion,
  setReferenceSource,
  substanceOf,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { freshDatabase, type TestDatabase, testTenantDatabase } from '@alloy-works/db/testing';
import {
  blockIdentifierFrom,
  readReferenceAnswer,
  type ContentDocument,
  type CslItem,
  type OutlineDocument,
  type ReferenceAnswer,
  type ReferenceRequest,
} from '@alloy-works/domain';
import {
  crossrefMarshRetraction,
  crossrefUpdates,
  crossrefWork,
  pubmedDunnart,
  pubmedSummary,
} from '@alloy-works/domain/sources-fixtures';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { nightDue, recheckEntries, REFERENCE_RATES } from './rechecks.js';
import type { Referencer } from './referencer.js';
import type { WorkerLog } from './worker.js';

const quiet: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} } as WorkerLog;

/** The fake connector: Crossref's marsh retracted, PubMed's dunnart current. */
function answering(request: ReferenceRequest): ReferenceAnswer {
  const results =
    request.source === 'crossref'
      ? readReferenceAnswer(
          'crossref',
          'check',
          crossrefWork(),
          crossrefUpdates([crossrefMarshRetraction]),
        )
      : readReferenceAnswer('pubmed', 'check', pubmedSummary([pubmedDunnart]));
  return { type: 'found', results: results ?? [] };
}

describe('the nightly re-check (the XR plan, XR-E)', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  const tenants: Tenant[] = [];
  const entries = new Map<Tenant, { crossref: string; pubmed: string; uncited: string }>();

  const as = <T>(tenant: Tenant, work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work);

  /** In this tenant: Ada, two entries obtained from a source and cited, a third obtained and not. */
  const seeded = (tenant: Tenant) =>
    as(tenant, async (trx) => {
      const ada = (
        await trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: 'ada',
            email: null,
            display_name: 'Ada',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      const general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      await grant(trx, {
        roleId: (await findRole(trx, 'Administrator'))!.id,
        subject: { principal: ada },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
      const entry = async (csl: CslItem, from: string) => {
        const made = await createEntry(trx, {
          author: ada,
          spaceId: general,
          entry: {
            csl,
            obtained: { from, at: '2026-01-02T03:04:05Z' },
          },
          despiteMatches: true,
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        return made.entry.id;
      };
      // Each as its source mapped it when it was obtained.
      const crossref = await entry(
        readReferenceAnswer('crossref', 'fetch', crossrefWork())![0]!.csl,
        'crossref:10.5555/marsh.2021.017',
      );
      const pubmed = await entry(
        readReferenceAnswer('pubmed', 'fetch', pubmedSummary([pubmedDunnart]))![0]!.csl,
        'pubmed:99000001',
      );
      const uncited = await entry({ type: 'book', title: 'Uncited' }, 'crossref:10.5555/uncited');
      const component = await createComponent(trx, {
        spaceId: general,
        title: 'Readings',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (component.answer !== 'created') throw new Error(component.answer);
      const substance = substanceOf(component.version);
      if (substance.kind !== 'component') throw new Error('not a component');
      const cited = await recordVersion(trx, {
        artifactId: component.version.artifactId,
        openedFrom: component.version.id,
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
                content: [
                  { type: 'citation', entry: crossref },
                  { type: 'citation', entry: pubmed },
                ],
              },
            ] as ContentDocument['content'],
          },
        },
      });
      if (cited.answer !== 'recorded') throw new Error(cited.answer);
      const document = await createDocument(trx, {
        spaceId: general,
        title: 'Report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (document.answer !== 'created') throw new Error(document.answer);
      const placed = await recordVersion(trx, {
        artifactId: document.version.artifactId,
        openedFrom: document.version.id,
        author: ada,
        substance: {
          kind: 'document',
          content: {
            ...(document.version.content as OutlineDocument),
            nodes: [
              {
                type: 'reference',
                id: blockIdentifierFrom(randomBytes(16)),
                component: component.version.artifactId,
                mode: { kind: 'latest' },
                numbered: true,
                matter: 'body',
                pageBreak: 'none',
                values: {},
                children: [],
              },
            ],
          },
        },
      });
      if (placed.answer !== 'recorded') throw new Error(placed.answer);
      entries.set(tenant, { crossref, pubmed, uncited });
    });

  beforeAll(async () => {
    db = await freshDatabase();
    await prepareDatabase(db.adminUrl);
    await migrate(db.migratorUrl);
    for (const [name, host] of [
      ['Production', 'acme.alloy.test'],
      ['Development', 'dev.acme.alloy.test'],
    ] as const) {
      tenants.push(
        await createTenant(db.adminUrl, db.migratorUrl, {
          organisation: { id: 'acme', name: 'Acme' },
          tenant: { id: db.newTenantId(), name },
          hostnames: [host],
        }),
      );
    }
    service = testTenantDatabase(db.serviceUrl);
    worker = testTenantDatabase(db.workerUrl);
    for (const tenant of tenants) await seeded(tenant);
  }, 120_000);

  afterAll(async () => {
    await service?.close();
    await worker?.close();
    await db?.drop();
  });

  it('LIB-036 checks each cited entry in every tenant, round-robin, each source within its budget, recording its status and telling the owner', async () => {
    const asked: { at: number; request: ReferenceRequest }[] = [];
    let clock = 0;
    const referencer: Referencer = async (request) => {
      asked.push({ at: clock, request });
      return answering(request);
    };
    // Development has PubMed switched off.
    await as(tenants[1]!, (trx) => setReferenceSource(trx, 'pubmed', false));
    const checked = await recheckEntries(worker, referencer, quiet, {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    expect(checked).toBe(3);
    // Crossref's: one from each tenant in turn; PubMed's, Production's alone.
    const crossref = asked.filter((each) => each.request.source === 'crossref');
    // In whatever order the tenants are listed: one from each, none twice.
    expect(crossref.map((each) => each.request.tenant).toSorted()).toEqual(
      tenants.map((each) => each.id).toSorted(),
    );
    expect(asked.filter((each) => each.request.source === 'pubmed')).toHaveLength(1);
    // Never past a source's budget: a tenth of a second between Crossref's calls.
    expect(crossref[1]!.at - crossref[0]!.at).toBeGreaterThanOrEqual(
      1000 / REFERENCE_RATES.crossref,
    );
    // Each asked a check, by its identifier alone.
    for (const { request } of asked) {
      expect(request.op).toBe('check');
      expect(request).not.toHaveProperty('query');
    }
    const [production, development] = tenants.map((each) => entries.get(each)!);
    expect(
      await as(tenants[0]!, (trx) => readEntryStatus(trx, production!.crossref)),
    ).toMatchObject({ outcome: 'retracted' });
    expect(await as(tenants[0]!, (trx) => readEntryStatus(trx, production!.pubmed))).toMatchObject({
      outcome: 'current',
    });
    expect(
      await as(tenants[1]!, (trx) => readEntryStatus(trx, development!.pubmed)),
    ).toBeUndefined();
    expect(
      await as(tenants[0]!, (trx) => readEntryStatus(trx, production!.uncited)),
    ).toBeUndefined();
    // Ada made the document, and is told of the retraction.
    const told = await as(tenants[0]!, (trx) =>
      trx.selectFrom('notification').select('kind').where('kind', '=', 'reference').execute(),
    );
    expect(told).toHaveLength(1);
  });

  it('records nothing for a source that fails, and leaves it for the next night', async () => {
    const referencer: Referencer = async (request) =>
      request.source === 'crossref'
        ? { type: 'failed', code: 'reference_unavailable', source: 'crossref', reason: 'timeout' }
        : 'busy';
    const production = entries.get(tenants[0]!)!;
    const before = await as(tenants[0]!, (trx) => readEntryStatus(trx, production.crossref));
    expect(await recheckEntries(worker, referencer, quiet, { sleep: async () => {} })).toBe(0);
    expect(await as(tenants[0]!, (trx) => readEntryStatus(trx, production.crossref))).toEqual(
      before,
    );
  });

  it('runs once a night, after two in the morning UTC', () => {
    const at = (iso: string) => new Date(iso);
    expect(nightDue(undefined, at('2026-10-22T01:59:00Z'))).toBe(false);
    expect(nightDue(undefined, at('2026-10-22T02:00:00Z'))).toBe(true);
    expect(nightDue(at('2026-10-22T02:10:00Z'), at('2026-10-22T23:00:00Z'))).toBe(false);
    expect(nightDue(at('2026-10-22T02:10:00Z'), at('2026-10-23T02:01:00Z'))).toBe(true);
  });
});
