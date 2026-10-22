import { randomBytes } from 'node:crypto';
import {
  blockIdentifierFrom,
  defaultNumberingScheme,
  type ContentDocument,
  type OutlineDocument,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeBaseline, readBaseline, requestBaselinePublication } from './baselines.js';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDocument } from './documents.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import {
  publicationInputs,
  readPublicationRequest,
  recordPublication,
  requestPublication,
  type PublicationInputs,
} from './publishing.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import { createTerm, recordTermVersion, type StoredTerm, type TermInput } from './terms.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { recordVersion, substanceOf, type StoredVersion } from './versions.js';
import { decideGate } from './workflow-gates.js';
import { moveArtifact } from './workflow.js';

/**
 * **The term versions a publish reads** (the TM plan, TMb, TM-G): each use's term at its latest
 * approved revision, decided as the publisher, recorded on the request and its publication, pinned by
 * a baseline, and what its terms report recorded on the request.
 */

const ISSUER = 'https://idp.example';

const term = (preferred: string, more: Partial<TermInput> = {}): TermInput => ({
  base: 'en',
  labels: [{ language: 'en', preferred, alternatives: [], abbreviation: 'RPM' }],
  definition: [{ language: 'en', text: 'Turns of a shaft in one minute.' }],
  broader: [],
  narrower: [],
  related: [],
  ...more,
});

describe('the term versions a publish reads (TMb)', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let general: string;
  let quality: string;

  const tenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);
  const may = () => true;

  const made = (input: TermInput, spaceId = general) =>
    tenant(async (trx) => {
      const answer = await createTerm(trx, { author: ada, spaceId, term: input });
      if (answer.answer !== 'created') throw new Error(JSON.stringify(answer));
      return answer.term;
    });

  /** Grace approves Ada's term at its latest version, designating a revision. */
  const approved = (stored: StoredTerm) =>
    tenant(async (trx) => {
      const answer = await decideGate(trx, {
        artifactId: stored.id,
        kind: 'term',
        transition: 'approve',
        version: stored.version.id,
        decision: 'approved',
        by: grace,
        may,
      });
      if (answer.answer !== 'passed') throw new Error(JSON.stringify(answer));
      return stored;
    });

  /** A component in General using each term in one paragraph, a mark each. */
  const using = (...terms: string[]) =>
    tenant(async (trx) => {
      const first = await createComponent(trx, {
        spaceId: general,
        title: 'Pump',
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
            content: terms.flatMap((each, n) => [
              { type: 'text' as const, value: ' at ', marks: [] },
              {
                type: 'text' as const,
                value: 'speed',
                marks: [{ type: 'definedTerm' as const, id: `m${n}`, term: each }],
              },
            ]),
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
        title: 'The pump report',
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

  /** What a publish of the document's version reads, as the worker reads it, and what it reported. */
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
        warnings: (await readPublicationRequest(trx, asked.request.id))!.warnings,
      };
    });

  const labelRead = (inputs: PublicationInputs, node: string, id: string) =>
    inputs.terms.get(node)?.get(id)?.term.labels[0]?.preferred;

  const baselineOf = (document: StoredVersion, name: string, maker = ada) =>
    tenant(async (trx) => {
      const answer = await makeBaseline(trx, {
        documentId: document.artifactId,
        version: document.id,
        name,
        maker,
      });
      if (answer.answer !== 'made') throw new Error(JSON.stringify(answer));
      return answer.baseline;
    });

  const baselinePublished = (baseline: string, requester = ada) =>
    tenant(async (trx) => {
      const asked = await requestBaselinePublication(trx, {
        baseline,
        formats: ['pdf'],
        requester,
      });
      if (asked.answer !== 'requested') throw new Error(JSON.stringify(asked));
      return {
        inputs: (await publicationInputs(trx, asked.request.id))!,
        warnings: (await readPublicationRequest(trx, asked.request.id))!.warnings,
      };
    });

  const deny = (principal: string, artifact: string) =>
    tenant(async (trx) =>
      grant(trx, {
        roleId: (await findRole(trx, 'Reader'))!.id,
        subject: { principal },
        level: { kind: 'artifact', id: artifact },
        effect: 'deny',
        grantedBy: ada,
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
    await tenant(async (trx) => {
      const person = (subject: string, name: string) =>
        trx
          .insertInto('principal')
          .values({ issuer: ISSUER, subject, email: null, display_name: name })
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

  it("LIB-016 records each term's latest approved revision a use reads, reaches the next approval at the next publish, and never a baseline's pin", async () => {
    const rpm = await approved(await made(term('revolutions per minute')));
    const { document, node } = await placing(await using(rpm.id));
    const first = await published(document);
    expect(labelRead(first.inputs, node, rpm.id)).toBe('revolutions per minute');
    expect(first.warnings).toEqual([]);
    const baseline = await baselineOf(document, 'Issued');
    expect(
      (await tenant((trx) => readBaseline(trx, baseline, ada)))?.pins.terms?.map(
        (each) => each.version,
      ),
    ).toEqual([rpm.version.id]);

    // A new version is a draft: the next publish still reads the approved revision, until approved.
    const changed = await tenant((trx) =>
      recordTermVersion(trx, {
        author: ada,
        id: rpm.id,
        openedFrom: rpm.version.id,
        term: term('rotations per minute'),
      }),
    );
    if (changed.answer !== 'recorded') throw new Error(changed.answer);
    expect(labelRead((await published(document)).inputs, node, rpm.id)).toBe(
      'revolutions per minute',
    );
    await approved(changed.term);
    const next = await published(document);
    expect(labelRead(next.inputs, node, rpm.id)).toBe('rotations per minute');
    // A baseline's publish reads what it pinned.
    const pinned = await baselinePublished(baseline);
    expect(labelRead(pinned.inputs, node, rpm.id)).toBe('revolutions per minute');

    // The publication records the term version it read.
    const recorded = await tenant(async (trx) => {
      const id = await recordPublication(trx, {
        requestId: next.request,
        pipelineVersion: '28',
        fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
        dataSha256: 'b'.repeat(64),
        numbering: { scheme: defaultNumberingScheme.id, entries: [] },
        outputs: [
          {
            format: 'pdf',
            engineVersion: '0.15.1',
            templateVersion: 24,
            key: `${production.role}/sha256/${'c'.repeat(64)}`,
            sha256: 'c'.repeat(64),
            bytes: 1000,
          },
        ],
      });
      return trx
        .selectFrom('publication_asset')
        .select(['version_id', 'asset_id'])
        .where('publication_id', '=', id!)
        .where('asset_kind', '=', 'term')
        .execute();
    });
    expect(recorded).toEqual([{ version_id: changed.term.version.id, asset_id: rpm.id }]);
  });

  it('LIB-018 LIB-050 prints a draft term as its words and reports it, a deprecated one naming its replacement, and a label in the base language by term and language', async () => {
    const draft = await made(term('gauge pressure'));
    const kpa = await approved(await made(term('kilopascal')));
    const psi = await approved(await made(term('pounds per square inch', { replacedBy: kpa.id })));
    await tenant((trx) =>
      moveArtifact(trx, {
        artifactId: psi.id,
        kind: 'term',
        transition: 'deprecate',
        from: 'approved',
        reason: 'Use the kilopascal',
        by: grace,
        may,
      }),
    );
    const french = await approved(
      await made({
        ...term('tours par minute'),
        base: 'fr',
        labels: [{ language: 'fr', preferred: 'tours par minute', alternatives: [] }],
        definition: [],
      }),
    );
    const { document, node } = await placing(await using(draft.id, psi.id, french.id));
    const { inputs, request, warnings } = await published(document);
    expect(inputs.terms.get(node)?.has(draft.id)).toBe(false);
    expect(inputs.terms.get(node)?.get(psi.id)?.deprecated).toBe(true);
    expect(warnings).toEqual([
      { code: 'term_unresolved', term: draft.id, count: 1 },
      { code: 'term_deprecated', term: psi.id, count: 1, replacedBy: kpa.id },
      { code: 'term_fallback', term: french.id, count: 1, language: 'en-GB' },
    ]);
    const kinds = await tenant((trx) =>
      trx
        .selectFrom('publication_request_asset')
        .select('asset_id')
        .where('request_id', '=', request)
        .where('asset_kind', '=', 'term')
        .execute(),
    );
    expect(kinds.map((each) => each.asset_id).sort()).toEqual([psi.id, french.id].sort());
  });

  it("offers a node no term of another space than its component's", async () => {
    const elsewhere = await approved(await made(term('Held in Quality'), quality));
    const { document, node } = await placing(await using(elsewhere.id));
    const { inputs, warnings } = await published(document);
    expect(inputs.terms.get(node)?.has(elsewhere.id) ?? false).toBe(false);
    expect(warnings).toEqual([{ code: 'term_unresolved', term: elsewhere.id, count: 1 }]);
  });

  it('reads a term as the publisher, of the latest and of a baseline, and pins only what the maker may read', async () => {
    const rpm = await approved(await made(term('withheld per minute')));
    const { document, node } = await placing(await using(rpm.id));
    const pinnedByAda = await baselineOf(document, 'By Ada');
    await deny(grace, rpm.id);
    const unresolved = [{ code: 'term_unresolved', term: rpm.id, count: 1 }];

    const latest = await published(document, grace);
    expect(latest.inputs.terms.get(node)?.has(rpm.id) ?? false).toBe(false);
    expect(latest.warnings).toEqual(unresolved);
    const asked = await tenant((trx) =>
      trx
        .selectFrom('publication_request_asset')
        .select('asset_id')
        .where('request_id', '=', latest.request)
        .execute(),
    );
    expect(asked).toEqual([]);

    // Grace publishes Ada's baseline: its pin is recorded, never read, and reported.
    const pinned = await baselinePublished(pinnedByAda, grace);
    expect(pinned.inputs.terms.get(node)?.has(rpm.id) ?? false).toBe(false);
    expect(pinned.warnings).toEqual(unresolved);
    // Grace's own baseline pins no term she may not read, and Ada reads none in it.
    const byGrace = await baselineOf(document, 'By Grace', grace);
    expect((await tenant((trx) => readBaseline(trx, byGrace, ada)))?.pins.terms).toBeUndefined();
    // And Grace reads no pin of Ada's she may not read.
    expect((await tenant((trx) => readBaseline(trx, pinnedByAda, grace)))?.pins.terms).toEqual([]);
  });
});
