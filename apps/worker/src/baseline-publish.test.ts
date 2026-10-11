import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  addThemeVersion,
  createComponent,
  createDocument,
  createJobQueue,
  createTenant,
  defaultLayout,
  defaultTheme,
  findRole,
  grant,
  makeBaseline,
  migrate,
  prepareDatabase,
  recordVersion,
  requestBaselinePublication,
  substanceOf,
  type JobQueue,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import {
  freshDatabase,
  queryAs,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import {
  blockIdentifierFrom,
  type ContentDocument,
  type Layout,
  type OutlineDocument,
  type OutlineNode,
} from '@alloy-works/domain';
import { createObjectStores, type ObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { checkJob } from './jobs/check.js';
import { publishJob } from './jobs/publish.js';
import { suiteChecker } from './testing/verapdf.js';
import { modeOf, recordedOutputs } from './testing/recorded.js';
import { processNextBesideChecks } from './testing/work.js';
import { createTypst, typstBinaryPath } from './typst.js';
import type { JobHandler, WorkerLog } from './worker.js';

const nodeId = () => blockIdentifierFrom(randomBytes(16));
const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };
const quiet: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * Publishing a baseline (baselines.md; the BL plan, Task 3): a request read from the baseline's pins
 * and compiled at its own time, so it is the same publication whatever has changed since.
 */
describe('publishing a baseline', () => {
  let db: TestDatabase;
  let objects: TestObjectStore;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let queue: JobQueue;
  let stores: ObjectStores;
  let tenant: Tenant;
  let handlers: Record<string, JobHandler>;
  let ada: string;
  let general: string;

  const tenantDo = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work);

  const work = () =>
    processNextBesideChecks(
      { queue, db: worker, handlers, workerId: 'worker-1', leaseMs: 60_000, log: quiet },
      checkJob({ db: worker, stores, checker: suiteChecker }),
    );

  /** A component in General whose one paragraph says this, at a version past its first. */
  const saying = async (trx: TenantTransaction, text: string) => {
    const made = await createComponent(trx, {
      spaceId: general,
      title: 'Calibration',
      language: 'en-GB',
      direction: 'ltr',
      author: ada,
    });
    if (made.answer !== 'created') throw new Error(made.answer);
    return revised(trx, made.version, text);
  };
  const revised = async (
    trx: TenantTransaction,
    version: Parameters<typeof substanceOf>[0],
    text: string,
  ) => {
    const substance = substanceOf(version);
    if (substance.kind !== 'component') throw new Error('not a component');
    const content: ContentDocument = {
      ...substance.content,
      content: [
        {
          type: 'paragraph',
          id: 'p1',
          style: 'body',
          content: [{ type: 'text', value: text, marks: [] }],
        },
      ],
    };
    const recorded = await recordVersion(trx, {
      artifactId: version.artifactId,
      openedFrom: version.id,
      author: ada,
      substance: { ...substance, content },
    });
    if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
    return recorded.version;
  };

  const publish = (baseline: string, formats = ['pdf', 'docx']) =>
    tenantDo(async (trx) => {
      const answer = await requestBaselinePublication(trx, { baseline, formats, requester: ada });
      if (answer.answer !== 'requested') throw new Error(answer.answer);
      return answer.request.id;
    });

  /** The publication a request made, with each output's digest by format. */
  const publicationOf = (request: string) =>
    tenantDo(async (trx) => {
      const publication = await trx
        .selectFrom('publication')
        .selectAll()
        .where('request_id', '=', request)
        .executeTakeFirstOrThrow();
      const outputs = await trx
        .selectFrom('publication_output')
        .select(['format', 'sha256'])
        .where('publication_id', '=', publication.id)
        .execute();
      return {
        publication,
        sha256: Object.fromEntries(outputs.map((each) => [each.format, each.sha256])),
      };
    });

  beforeAll(async () => {
    const fonts = await loadPinnedFonts();
    const typst = createTypst({ binary: typstBinaryPath(), fonts });
    db = await freshDatabase();
    objects = await testObjectStore();
    await prepareDatabase(db.adminUrl);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    await objects.setUp(db.adminUrl, tenant);
    service = testTenantDatabase(db.serviceUrl);
    worker = testTenantDatabase(db.workerUrl);
    queue = createJobQueue(db.workerUrl);
    stores = createObjectStores(objects.settings, objects.sealingKey);
    const job = publishJob({ db: worker, stores, typst, fonts });
    handlers = { publish: job, preview: job };
    await tenantDo(async (trx) => {
      ada = (
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
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      for (const role of ['Author', 'Publisher']) {
        await grant(trx, {
          roleId: (await findRole(trx, role))!.id,
          subject: { principal: ada },
          level: { kind: 'space', id: general },
          effect: 'allow',
          grantedBy: ada,
        });
      }
    });
  }, 120_000);

  afterAll(async () => {
    await queue?.close();
    await worker?.close();
    await service?.close();
    await objects?.drop();
    await db?.drop();
  });

  /**
   * The regression guard's baselines (PUB-075; the BL plan, BL-J): fixed documents, made baselines
   * and set to a fixed instant, published through the job; every output held to the SHA-256 recorded
   * beside the corpus's, so a change to the pipeline, the engine or a library they depend on fails
   * here before a customer re-publishes one. Ids are fixed where the outputs could carry them. First, before
   * any test moves the environment's layout or theme on.
   */
  it('PUB-075 holds each guard baseline’s outputs to the digests recorded for them', async () => {
    const outputs = await recordedOutputs({
      pins: fileURLToPath(new URL('./testing/recorded-outputs.json', import.meta.url)),
      mode: modeOf(process.env['ALLOY_RECORD']),
      ...(process.env['ALLOY_CORPUS_DIFFERENCES']
        ? { keep: process.env['ALLOY_CORPUS_DIFFERENCES'] }
        : {}),
    });
    const caseName = expect.getState().currentTestName ?? 'outside a case';
    const cases: { title: string; text: readonly string[] }[] = [
      {
        title: 'The calibration procedure',
        text: ['Set the tray before every run.', 'Wait for the light, then press Start.'],
      },
      {
        title: 'The dosing report',
        text: ['Dose by weight.', 'Record each dose as it is given, and who gave it.'],
      },
    ];
    for (const [index, each] of cases.entries()) {
      const baseline = await tenantDo(async (trx) => {
        const made = await createComponent(trx, {
          spaceId: general,
          title: each.title,
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        const substance = substanceOf(made.version);
        if (substance.kind !== 'component') throw new Error('not a component');
        const component = await recordVersion(trx, {
          artifactId: made.version.artifactId,
          openedFrom: made.version.id,
          author: ada,
          substance: {
            ...substance,
            content: {
              ...substance.content,
              content: each.text.map((text, at) => ({
                type: 'paragraph' as const,
                id: `p${at + 1}`,
                style: 'body',
                content: [{ type: 'text' as const, value: text, marks: [] }],
              })),
            },
          },
        });
        if (component.answer !== 'recorded') throw new Error(component.answer);
        const document = await createDocument(trx, {
          spaceId: general,
          title: each.title,
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
        });
        if (document.answer !== 'created') throw new Error(document.answer);
        const nodes: OutlineNode[] = [
          {
            type: 'section',
            id: `guard${'ab'[index]}section`.padEnd(26, 'a'),
            title: [{ type: 'text', value: 'Method', marks: [] }],
            ...base,
            children: [
              {
                type: 'reference',
                id: `guard${'ab'[index]}reference`.padEnd(26, 'a'),
                component: component.version.artifactId,
                mode: { kind: 'latest' },
                ...base,
                children: [],
              },
            ],
          },
        ];
        const outline = await recordVersion(trx, {
          artifactId: document.version.artifactId,
          openedFrom: document.version.id,
          author: ada,
          substance: {
            kind: 'document',
            content: { ...(document.version.content as OutlineDocument), nodes },
          },
        });
        if (outline.answer !== 'recorded') throw new Error(outline.answer);
        const made2 = await makeBaseline(trx, {
          documentId: outline.version.artifactId,
          version: outline.version.id,
          name: 'Guard',
          maker: ada,
        });
        if (made2.answer !== 'made') throw new Error(made2.answer);
        return made2.baseline;
      });
      // A fixed instant, as the corpus compiles at one: set past the runtime role's grants.
      await queryAs(
        db.adminUrl,
        `update ${tenant.role}.baseline set made_at = '2026-09-19T00:00:00Z' where id = $1`,
        [baseline],
      );
      const request = await publish(baseline);
      expect(await work()).toBe('done');
      const store = await tenantDo((trx) => stores.forTenant(trx, tenant));
      const made = await tenantDo((trx) =>
        trx
          .selectFrom('publication as p')
          .innerJoin('publication_output as o', 'o.publication_id', 'p.id')
          .select(['o.format', 'o.object_key'])
          .where('p.request_id', '=', request)
          .execute(),
      );
      for (const format of ['pdf', 'docx'] as const) {
        const output = made.find((row) => row.format === format)!;
        outputs.check(caseName, format, await store.get(output.object_key));
      }
    }
    await outputs.write();
  });

  it('PUB-046 PUB-045 PUB-013 publishes a baseline to the same bytes after its components, the layout and the theme have all moved on, recording what made it', async () => {
    const made = await tenantDo(async (trx) => {
      const calibration = await saying(trx, 'Set the tray before every run.');
      const document = await createDocument(trx, {
        spaceId: general,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (document.answer !== 'created') throw new Error(document.answer);
      const nodes: OutlineNode[] = [
        {
          type: 'section',
          id: nodeId(),
          title: [{ type: 'text', value: 'Method', marks: [] }],
          ...base,
          children: [
            {
              type: 'reference',
              id: nodeId(),
              component: calibration.artifactId,
              mode: { kind: 'latest' },
              ...base,
              children: [],
            },
          ],
        },
      ];
      const outline = await recordVersion(trx, {
        artifactId: document.version.artifactId,
        openedFrom: document.version.id,
        author: ada,
        substance: {
          kind: 'document',
          content: { ...(document.version.content as OutlineDocument), nodes },
        },
      });
      if (outline.answer !== 'recorded') throw new Error(outline.answer);
      const baseline = await makeBaseline(trx, {
        documentId: outline.version.artifactId,
        version: outline.version.id,
        name: 'As approved',
        maker: ada,
      });
      if (baseline.answer !== 'made') throw new Error(baseline.answer);
      return { calibration, baseline: baseline.baseline };
    });

    const first = await publish(made.baseline);
    expect(await work()).toBe('done');
    const before = await publicationOf(first);

    // Everything live moves on: the component, the environment's layout and its theme.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const pinned = await tenantDo(async (trx) => {
      await revised(trx, made.calibration, 'Set the tray, then wait an hour.');
      const layout = await defaultLayout(trx);
      const words: Layout = {
        ...layout.layout,
        words: { ...layout.layout.words, contents: 'Table of contents' },
      };
      const nextLayout = await recordVersion(trx, {
        artifactId: layout.artifactId,
        openedFrom: layout.versionId,
        author: ada,
        substance: { kind: 'layout', content: words },
      });
      if (nextLayout.answer !== 'recorded') throw new Error(nextLayout.answer);
      const theme = await defaultTheme(trx);
      const nextTheme = await addThemeVersion(trx, {
        artifactId: theme.artifactId,
        openedFrom: theme.versionId,
        author: ada,
        theme: { ...theme.content, paper: '#fafafa' },
      });
      if (nextTheme.answer !== 'recorded') throw new Error(nextTheme.answer);
      return { layout: layout.versionId, theme: theme.versionId };
    });

    const second = await publish(made.baseline);
    expect(await work()).toBe('done');
    const after = await publicationOf(second);

    expect(after.sha256.pdf).toBe(before.sha256.pdf);
    expect(after.sha256.docx).toBe(before.sha256.docx);
    expect(after.publication.data_sha256).toBe(before.publication.data_sha256);
    expect(after.publication).toMatchObject({
      approval: 'baseline',
      baseline_id: made.baseline,
      layout_version_id: pinned.layout,
      theme_version_id: pinned.theme,
      engine: 'typst',
      template: 'publication',
      pipeline_version: before.publication.pipeline_version,
    });
    expect(after.publication.id).not.toBe(before.publication.id);
  });
});
