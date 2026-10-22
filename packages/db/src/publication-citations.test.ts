import { randomBytes } from 'node:crypto';
import {
  assemble,
  blockIdentifierFrom,
  defaultNumberingScheme,
  DEFAULT_CITATION_STYLE,
  type ContentDocument,
  type CslItem,
  type OutlineDocument,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeBaseline, requestBaselinePublication } from './baselines.js';
import { createEntry, recordEntryVersion, type StoredEntry } from './bibliography.js';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDocument } from './documents.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import {
  publicationInputs,
  recordPublication,
  requestPublication,
  type PublicationInputs,
} from './publishing.js';
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

/**
 * **The entry versions a publish reads** (the CI plan, CIc; LIB-047, which no design claims yet):
 * recorded on its request and its publication as its images are, read again at the latest by the next
 * publish, and pinned by a baseline, whose publish never reads a later one.
 */

const ISSUER = 'https://idp.example';

const tides: CslItem = {
  type: 'article-journal',
  title: 'Tidal patterns of the northern estuary',
  author: [{ family: 'Marlow', given: 'Ada' }],
  issued: { 'date-parts': [[2020]] },
  'container-title': 'Journal of Coastal Studies',
};

describe('the entry versions a publish reads (CIc)', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let general: string;
  let quality: string;

  const tenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);

  const entryIn = (spaceId: string, csl: CslItem) =>
    tenant(async (trx) => {
      const answer = await createEntry(trx, { author: ada, spaceId, entry: { csl } });
      if (answer.answer !== 'created') throw new Error(JSON.stringify(answer));
      return answer.entry;
    });

  /** A component in General citing each entry in one paragraph. */
  const citing = (...entries: string[]) =>
    tenant(async (trx) => {
      const first = await createComponent(trx, {
        spaceId: general,
        title: 'Sources',
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
              ...entries.map((entry) => ({ type: 'citation' as const, entry })),
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

  /** A document in General placing the component, and the node it stands at. */
  const placing = (component: StoredVersion) =>
    tenant(async (trx) => {
      const created = await createDocument(trx, {
        spaceId: general,
        title: 'The estuary report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (created.answer !== 'created') throw new Error(created.answer);
      const node = blockIdentifierFrom(randomBytes(16));
      const outline: OutlineDocument = {
        ...(created.version.content as OutlineDocument),
        nodes: [
          {
            type: 'reference',
            id: node,
            component: component.artifactId,
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
      return { document: recorded.version, node };
    });

  /** What a publish of the document's version reads, as the worker reads it. */
  const published = (document: StoredVersion, requester = ada) =>
    tenant(async (trx) => {
      const asked = await requestPublication(trx, {
        documentId: document.artifactId,
        version: document.id,
        formats: ['pdf'],
        requester,
      });
      if (asked.answer !== 'requested') throw new Error(JSON.stringify(asked));
      return {
        request: asked.request.id,
        inputs: (await publicationInputs(trx, asked.request.id))!,
      };
    });

  const titleRead = (inputs: PublicationInputs, node: string, entry: StoredEntry) =>
    inputs.citations.entries.get(node)?.get(entry.id)?.title;

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
      ada = (
        await trx
          .insertInto('principal')
          .values({ issuer: ISSUER, subject: 'ada', email: null, display_name: 'Ada' })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      grace = (
        await trx
          .insertInto('principal')
          .values({ issuer: ISSUER, subject: 'grace', email: null, display_name: 'Grace' })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      const administrator = await findRole(trx, 'Administrator');
      for (const [principal, space] of [
        [ada, general],
        [ada, quality],
        [grace, general],
      ] as const) {
        await grant(trx, {
          roleId: administrator!.id,
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

  it("records each entry version a citation reads, reaches a change at the next publish, and never a baseline's pin", async () => {
    const entry = await entryIn(general, tides);
    const { document, node } = await placing(await citing(entry.id));
    const first = await published(document);
    expect(titleRead(first.inputs, node, entry)).toBe(tides.title);
    // The theme's style at the version it names: the default theme's Harvard.
    expect(first.inputs.citations.style?.csl).toContain('Cite Them Right');
    const baseline = await tenant((trx) =>
      makeBaseline(trx, {
        documentId: document.artifactId,
        version: document.id,
        name: 'Issued',
        maker: ada,
      }),
    );
    if (baseline.answer !== 'made') throw new Error(JSON.stringify(baseline));

    const changed = await tenant((trx) =>
      recordEntryVersion(trx, {
        author: ada,
        id: entry.id,
        openedFrom: entry.version.id,
        entry: { csl: { ...tides, title: 'Tidal patterns, revised' } },
      }),
    );
    if (changed.answer !== 'recorded') throw new Error(changed.answer);
    // An unpinned citation reads the change at the next publish.
    const next = await published(document);
    expect(titleRead(next.inputs, node, entry)).toBe('Tidal patterns, revised');
    // A baseline's publish reads what it pinned.
    const pinned = await tenant(async (trx) => {
      const asked = await requestBaselinePublication(trx, {
        baseline: baseline.baseline,
        formats: ['pdf'],
        requester: ada,
      });
      if (asked.answer !== 'requested') throw new Error(JSON.stringify(asked));
      return (await publicationInputs(trx, asked.request.id))!;
    });
    expect(titleRead(pinned, node, entry)).toBe(tides.title);

    // The publication records the entry version it read, and the style version its theme names.
    const publication = await tenant(async (trx) => {
      const id = await recordPublication(trx, {
        requestId: next.request,
        pipelineVersion: '27',
        fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
        dataSha256: 'b'.repeat(64),
        numbering: { scheme: defaultNumberingScheme.id, entries: [] },
        outputs: [
          {
            format: 'pdf',
            engineVersion: '0.15.1',
            templateVersion: 23,
            key: `${production.role}/sha256/${'c'.repeat(64)}`,
            sha256: 'c'.repeat(64),
            bytes: 1000,
          },
        ],
      });
      return trx
        .selectFrom('publication as p')
        .select(['p.citation_style_id', 'p.citation_style_version_id'])
        .select((eb) =>
          eb
            .selectFrom('publication_asset as a')
            .select('a.version_id')
            .whereRef('a.publication_id', '=', 'p.id')
            .where('a.asset_kind', '=', 'bibliographyEntry')
            .as('entry_version'),
        )
        .where('p.id', '=', id!)
        .executeTakeFirstOrThrow();
    });
    expect(publication).toEqual({
      citation_style_id: DEFAULT_CITATION_STYLE.id,
      citation_style_version_id: DEFAULT_CITATION_STYLE.version,
      entry_version: changed.entry.version.id,
    });
  });

  it("offers a node no entry of another space than its component's", async () => {
    const elsewhere = await entryIn(quality, { ...tides, title: 'Held in Quality' });
    const { document, node } = await placing(await citing(elsewhere.id));
    const { inputs } = await published(document);
    expect(titleRead(inputs, node, elsewhere)).toBeUndefined();
  });

  it('CNT-054 fails a publish of the latest and of a baseline by the citation where its publisher may not read the entry, reading and recording none', async () => {
    const entry = await entryIn(general, { ...tides, title: 'Withheld from Grace' });
    const { document, node } = await placing(await citing(entry.id));
    // Ada pins it; Grace reads the document and the component, and is then denied the entry.
    const baseline = await tenant((trx) =>
      makeBaseline(trx, {
        documentId: document.artifactId,
        version: document.id,
        name: 'Pinned',
        maker: ada,
      }),
    );
    if (baseline.answer !== 'made') throw new Error(JSON.stringify(baseline));
    await tenant(async (trx) =>
      grant(trx, {
        roleId: (await findRole(trx, 'Reader'))!.id,
        subject: { principal: grace },
        level: { kind: 'artifact', id: entry.id },
        effect: 'deny',
        grantedBy: ada,
      }),
    );
    const failsWith = (inputs: PublicationInputs) => {
      expect(inputs.citations.entries.get(node)?.has(entry.id) ?? false).toBe(false);
      const made = assemble({
        formats: ['pdf'],
        outline: inputs.outline,
        occurrences: new Map([...inputs.occurrences].map(([at, each]) => [at, each.content])),
        refused: inputs.refused,
        layout: inputs.layout!.layout,
        theme: inputs.theme!.theme,
        revision: inputs.revision,
        covers: () => true,
        assets: new Map(),
        citations: {
          ...inputs.citations,
          render: () => {
            throw new Error('Nothing is rendered where a citation fails');
          },
        },
      });
      expect(made).toEqual({
        ok: false,
        failures: [
          expect.objectContaining({
            code: 'citation_unresolved',
            node,
            block: 'p1',
            detail: `1: ${entry.id}`,
          }),
        ],
      });
    };

    const latest = await published(document, grace);
    failsWith(latest.inputs);
    const recorded = await tenant((trx) =>
      trx
        .selectFrom('publication_request_asset')
        .select('asset_id')
        .where('request_id', '=', latest.request)
        .execute(),
    );
    expect(recorded).toEqual([]);

    const pinned = await tenant(async (trx) => {
      const asked = await requestBaselinePublication(trx, {
        baseline: baseline.baseline,
        formats: ['pdf'],
        requester: grace,
      });
      if (asked.answer !== 'requested') throw new Error(JSON.stringify(asked));
      return (await publicationInputs(trx, asked.request.id))!;
    });
    failsWith(pinned);
  });
});
