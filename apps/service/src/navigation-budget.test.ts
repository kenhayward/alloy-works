import { randomBytes } from 'node:crypto';
import { arch, availableParallelism, cpus, loadavg, platform } from 'node:os';
import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createComponent,
  createDocument,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  migrate,
  recordVersion,
  seedDevelopmentContent,
  substanceOf,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import {
  blockIdentifierFrom,
  OUTLINE_SCHEMA_VERSION,
  type OutlineDocument,
  type OutlineNode,
} from '@alloy-works/domain';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { bindingBudget } from './test/budget.js';
import { signIn } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
const MATHML = '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mi>a</mi></math>';

/** The reference configuration: the document STR-063 states its budget against. */
const CHAPTERS = 20;
const SECTIONS_PER_CHAPTER = 4;
const REFERENCES_PER_SECTION = 5;
const COMPONENTS = 150;
const BLOCKS_PER_COMPONENT = 40;
const WARM_UP = 5;
const SAMPLES = 40;
// Held to the p95 and the maximum on a named machine, and to the maximum alone on a shared CI runner,
// whose speed varies by more than the budget's margin (issue #179). The p95 is recorded either way.
const BUDGET = bindingBudget(process.env);

const percentile = (samples: readonly number[], p: number) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
};
const summary = (samples: readonly number[]) => ({
  n: samples.length,
  p50: Number(percentile(samples, 50).toFixed(1)),
  p95: Number(percentile(samples, 95).toFixed(1)),
  max: Number(Math.max(...samples).toFixed(1)),
});

const newId = () => blockIdentifierFrom(randomBytes(16));
const text = (value: string) => [{ type: 'text' as const, value, marks: [] }];

/** One block of a component, a tenth each figures, tables, equations and footnotes, the rest prose. */
const block = (component: number, index: number) => {
  const id = `b${component}x${index}`;
  const words = `Step ${index} of procedure ${component}: `.padEnd(220, 'lorem ipsum ');
  switch (index % 10) {
    case 0:
      return {
        type: 'figure',
        id,
        asset: 'asset',
        imageStyle: 'wide',
        caption: `Figure caption ${index}`,
        alternative: { kind: 'decorative' },
      };
    case 3:
      return {
        type: 'table',
        id,
        caption: `Table caption ${index}`,
        headerRows: 0,
        headerColumns: 0,
        rows: [{ cells: [{ content: [{ type: 'paragraph', id: `${id}c`, content: text('A') }] }] }],
      };
    case 5:
      return { type: 'equation', id, mathml: MATHML, numbered: true };
    case 7:
      return {
        type: 'paragraph',
        id,
        content: [
          { type: 'text', value: words },
          {
            type: 'footnote',
            id: `${id}n`,
            anchor: { kind: 'span' },
            content: [{ type: 'paragraph', id: `${id}p`, content: text('A note') }],
          },
        ],
      };
    default:
      return { type: 'paragraph', id, content: [{ type: 'text', value: words }] };
  }
};

/** What the contributions route answers, as far as this test reads it. */
interface Contributions {
  occurrences: { node: string; version: string | null }[];
  versions: { id: string; contributions: { sequence: string }[] }[];
}

/** What the numbering route answers, as far as this test reads it. */
interface Numbering {
  entries: { sequence: string; number: string | null }[];
}

describe('STR-063 opens, numbers and restructures a document of five hundred nodes within the interactive budget', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let cookie: string;
  let document: string;
  let version: string;
  let chapters: string[];
  // The configuration the budget was measured on, recorded beside the result (STR-063).
  const configuration = {
    platform: `${platform()} ${arch()}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    // The logical CPUs the machine has, whatever a container or runner lets this process use.
    cpus: cpus().length,
    // How many of them this process may run on at once: a container's or a runner's limit, where set.
    parallelism: availableParallelism(),
    node: process.version,
    // Always [0, 0, 0] on Windows, which is still a value.
    loadavg: loadavg().map((load) => Number(load.toFixed(2))),
    // Which bounds this run was held to, so a result read later says what it proved (issue #179).
    held:
      BUDGET.p95 === null ? 'the maximum alone, on a shared CI runner' : 'the p95 and the maximum',
  };
  const report: Record<string, unknown> = { configuration };

  const call = (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) =>
    app.inject({ method, url, headers: { host: HOST, cookie }, ...(payload ? { payload } : {}) });

  const timed = async <Answer extends { statusCode: number; body: string }>(
    work: () => Promise<Answer>,
  ) => {
    const started = performance.now();
    const answer = await work();
    const elapsed = performance.now() - started;
    expect(answer.statusCode, answer.body.slice(0, 200)).toBe(200);
    return { elapsed, answer };
  };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    idp = await startStandInProvider({
      clients: [
        {
          clientId: 'alloy',
          clientSecret: 'stand-in-secret',
          redirectUris: [`http://${HOST}/v1/sign-in/organisation/callback`],
        },
      ],
    });
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    await configureOrganisationSignIn(db.adminUrl, tenant, {
      issuer: idp.issuer,
      clientId: 'alloy',
      secretName: 'stand_in',
    });
    tenantDb = createTenantDatabase(db.serviceUrl);
    await tenantDb.withTenant(tenant, (trx) => seedDevelopmentContent(trx, { issuer: idp.issuer }));
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
    });
    cookie = await signIn(app, HOST, 'grace', idp.issuer);
    const grace = (await call('GET', '/v1/me')).json<{ id: string }>().id;

    // Seeded through the store, not through five hundred acts: what is measured is reading and acting
    // on a document this size, not building one.
    await tenantDb.withTenant(tenant, async (trx) => {
      const general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      const author = await findRole(trx, 'Author');
      await grant(trx, {
        roleId: author!.id,
        subject: { principal: grace },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: grace,
      });
      const components: string[] = [];
      for (let index = 0; index < COMPONENTS; index += 1) {
        const made = await createComponent(trx, {
          spaceId: general,
          title: `Procedure ${index}`,
          language: 'en-GB',
          direction: 'ltr',
          author: grace,
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        const substance = substanceOf(made.version);
        if (substance.kind !== 'component') throw new Error('not a component');
        const content = Array.from({ length: BLOCKS_PER_COMPONENT }, (_, at) => block(index, at));
        const recorded = await recordVersion(trx, {
          artifactId: made.version.artifactId,
          openedFrom: made.version.id,
          author: grace,
          substance: { ...substance, content: { ...substance.content, content } as never },
        });
        if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
        components.push(made.version.artifactId);
      }
      const made = await createDocument(trx, {
        spaceId: general,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        author: grace,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const switches = { numbered: true, matter: 'body', pageBreak: 'none', values: {} } as const;
      let placed = 0;
      const nodes: OutlineNode[] = Array.from({ length: CHAPTERS }, (_, chapter) => ({
        type: 'section',
        id: newId(),
        title: text(`Chapter ${chapter + 1}`),
        ...switches,
        children: Array.from({ length: SECTIONS_PER_CHAPTER }, (_, section) => ({
          type: 'section',
          id: newId(),
          title: text(`Section ${chapter + 1}.${section + 1}`),
          ...switches,
          children: Array.from({ length: REFERENCES_PER_SECTION }, () => ({
            type: 'reference',
            id: newId(),
            component: components[(placed++ * 7) % COMPONENTS]!,
            mode: { kind: 'latest' },
            ...switches,
            children: [],
          })),
        })),
      }));
      const outline: OutlineDocument = {
        schemaVersion: OUTLINE_SCHEMA_VERSION,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        nodes,
      };
      const recorded = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: grace,
        substance: { kind: 'document', content: outline },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      document = made.version.artifactId;
      version = recorded.version.id;
      chapters = nodes.map((node) => node.id);
    });
  }, 300_000);

  afterAll(async () => {
    console.info(`Navigation budget report\n${JSON.stringify(report, null, 2)}`);
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await db?.drop();
  });

  /**
   * Warm-up calls first, then the samples; the p95 and the largest held to the budget. What was
   * measured is written into the test's own `meta`, which the JSON reporter carries into
   * `.trace-results/service.json` beside this test's result - before the budget is held to it, so a
   * failing run records its numbers too.
   */
  const measure = async (name: string, meta: object, work: () => Promise<{ elapsed: number }>) => {
    for (let index = 0; index < WARM_UP; index += 1) await work();
    const samples: number[] = [];
    for (let index = 0; index < SAMPLES; index += 1) samples.push((await work()).elapsed);
    report[name] = summary(samples);
    Object.assign(meta, { navigationBudget: { configuration, [name]: report[name] } });
    if (BUDGET.p95 !== null) {
      expect(percentile(samples, 95), name).toBeLessThanOrEqual(BUDGET.p95);
    }
    expect(Math.max(...samples), name).toBeLessThanOrEqual(BUDGET.max);
  };

  it('opens the document within the budget', async ({ task }) => {
    expect(configuration.platform.trim()).not.toBe('');
    expect(configuration.cpu.trim()).not.toBe('');
    expect(configuration.node.trim()).not.toBe('');
    expect(configuration.parallelism).toBeGreaterThan(0);
    interface Shown {
      type: string;
      children: Shown[];
    }
    const opened = (await call('GET', `/v1/documents/${document}`)).json<{
      outline: { nodes: Shown[] };
    }>();
    const every = (list: Shown[]): Shown[] =>
      list.flatMap((node) => [node, ...every(node.children)]);
    const shown = every(opened.outline.nodes);
    report.nodes = shown.length;
    report.references = shown.filter((node) => node.type === 'reference').length;
    // The size STR-063 states, read off what the route answered rather than off how it was built.
    expect(report.nodes).toBe(500);
    expect(report.references).toBe(400);
    report.bytes = (await call('GET', `/v1/documents/${document}`)).body.length;
    await measure('document', task.meta, () =>
      timed(() => call('GET', `/v1/documents/${document}`)),
    );
    // What the JSON reporter writes beside this result: the configuration and the measurement.
    expect(task.meta).toEqual({ navigationBudget: { configuration, document: report.document } });
  });

  it('answers what every occurrence contributes within the budget', async ({ task }) => {
    const answered = await call('GET', `/v1/documents/${document}/contributions`);
    const contributions = answered.json<Contributions>();
    expect(contributions.occurrences).toHaveLength(400);
    expect(contributions.occurrences.filter((each) => each.version === null)).toEqual([]);
    expect(contributions.versions).toHaveLength(COMPONENTS);
    for (const each of contributions.versions) {
      expect(each.contributions.map((contribution) => contribution.sequence).sort()).toEqual(
        ['equation', 'figure', 'footnote', 'table'].flatMap((sequence) => Array(4).fill(sequence)),
      );
    }
    report.contributionsBytes = answered.body.length;
    await measure('contributions', task.meta, () =>
      timed(() => call('GET', `/v1/documents/${document}/contributions`)),
    );
  });

  it('numbers the document within the budget', async ({ task }) => {
    const numbering = (await call('GET', `/v1/documents/${document}/numbering`)).json<Numbering>();
    expect(numbering.entries.filter((entry) => entry.number === null)).toEqual([]);
    // Four hundred occurrences of sixteen numbered contributions each.
    expect(numbering.entries.filter((entry) => entry.sequence !== 'section')).toHaveLength(6400);
    await measure('numbering', task.meta, () =>
      timed(() => call('GET', `/v1/documents/${document}/numbering`)),
    );
  });

  it('answers a move within the budget', async ({ task }) => {
    let down = true;
    await measure('move', task.meta, async () => {
      const openedFrom = version;
      const result = await timed(() =>
        call('POST', `/v1/documents/${document}/outline`, {
          openedFrom,
          operation: {
            operation: 'move',
            node: chapters[0]!,
            parent: null,
            position: down ? 1 : 0,
          },
        }),
      );
      version = result.answer.json<{ version: { id: string } }>().version.id;
      // Every sample recorded an act, never an unchanged answer.
      expect(version).not.toBe(openedFrom);
      down = !down;
      return result;
    });
  });
});
