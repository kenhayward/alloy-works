import {
  DEFINITION_SCHEMA_VERSION,
  TEMPLATE_SCHEMA_VERSION,
  type OutlineDocument,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import {
  makeCohortRow,
  pendingRows,
  readCohort,
  rerunCohort,
  submitCohort,
  titleFor,
  type StoredCohort,
} from './cohorts.js';
import { grant } from './grants.js';
import { DEFAULT_LAYOUT_ID } from './layouts.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import type { TenantTransaction } from './tables.js';
import { createTemplate, recordTemplateVersion } from './templates.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { DEFAULT_THEME_ID } from './themes.js';
import { createArtifact, latestVersion } from './versions.js';

const REVIEW = '5c4e0000-0000-4000-8000-0000000000c1';
const SITE = 'f1e1d000-0000-4000-8000-0000000000c1';

const site = {
  name: 'site',
  type: { base: 'text' },
  required: true,
  list: false,
  permitted: { values: ['Leeds', 'York', 'Hull'] },
  changeable: false,
  feeds: { field: SITE, arguments: true },
};
const definition = (title: string) => ({
  schemaVersion: TEMPLATE_SCHEMA_VERSION,
  name: 'Site report',
  theme: DEFAULT_THEME_ID,
  layout: DEFAULT_LAYOUT_ID,
  schemas: [{ schema: REVIEW, level: 'document', requires: [] }],
  outline: {
    sections: [
      {
        key: 'findings',
        title: [{ type: 'text', value: title, marks: [] }],
        required: false,
        numbered: true,
        matter: 'body',
        pageBreak: 'none',
        children: [],
      },
    ],
  },
  changes: { add: true, remove: true, reorder: true },
  parameters: [site],
});

describe('cohorts (the R7 plan, R7-A to R7-G)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let general = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  /** Every pending row made, each in a transaction of its own, as the worker makes them. */
  const run = async (cohort: string) => {
    const read = (await as((trx) => readCohort(trx, cohort)))!;
    for (const row of await as((trx) => pendingRows(trx, cohort))) {
      await as((trx) => makeCohortRow(trx, read, row));
    }
    return (await as((trx) => readCohort(trx, cohort)))!;
  };
  const documentsIn = () =>
    as(async (trx) =>
      Number(
        (
          await trx
            .selectFrom('artifact')
            .select((eb) => eb.fn.countAll().as('n'))
            .where('kind', '=', 'document')
            .executeTakeFirstOrThrow()
        ).n,
      ),
    );

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
    await as(async (trx) => {
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
      const identity = (id: string, name: string) =>
        ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name }) as const;
      await createArtifact(trx, {
        author: ada,
        substance: {
          kind: 'field',
          content: {
            ...identity(SITE, 'Site'),
            dataType: 'text',
            multiplicity: 'one',
            validation: {},
          },
        },
      });
      await createArtifact(trx, {
        author: ada,
        substance: {
          kind: 'metadataSchema',
          content: {
            ...identity(REVIEW, 'Review'),
            entries: [{ field: SITE, required: false, fixed: false }],
          },
        },
      });
      await grant(trx, {
        roleId: (await findRole(trx, 'Author'))!.id,
        subject: { principal: ada },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  const template = async (title = 'Findings') => {
    const made = await as((trx) =>
      createTemplate(trx, { spaceId: general, definition: definition(title), author: ada }),
    );
    if (made.answer !== 'created') throw new Error(made.answer);
    return made.template;
  };

  const submitted = async (templateId: string, rows: Record<string, unknown>[]) => {
    const answer = await as((trx) =>
      submitCohort(trx, {
        by: ada,
        spaceId: general,
        template: templateId,
        title: 'Site report: {site}',
        language: 'en-GB',
        direction: 'ltr',
        rows,
        source: { rows: rows.length },
      }),
    );
    if (answer.answer !== 'submitted') throw new Error(answer.answer);
    return answer;
  };

  it('REU-031 REU-033 makes a document for each row, and fails a row alone, reported, leaving nothing of it', async () => {
    const before = await documentsIn();
    const { cohort, job } = await submitted((await template()).id, [
      { site: 'Leeds' },
      { site: 'Sheffield' },
      { site: 'York' },
    ]);
    expect(job).toMatchObject({ kind: 'cohort', subject: cohort.id, parameters: { rows: 3 } });
    expect(cohort.rows.map((each) => each.state)).toEqual(['pending', 'pending', 'pending']);

    const made = await run(cohort.id);
    expect(made.rows.map((each) => each.state)).toEqual(['made', 'failed', 'made']);
    expect(made.rows[1]!.failure).toMatchObject({ code: 'parameter.invalid' });
    expect(made.rows[1]!.document).toBeNull();
    // Two documents, and none for the row that failed.
    expect(await documentsIn()).toBe(before + 2);
    const titles = await as(async (trx) =>
      Promise.all(
        made.rows
          .filter((each) => each.document !== null)
          .map(
            async (each) =>
              ((await latestVersion(trx, each.document!))!.content as OutlineDocument).title,
          ),
      ),
    );
    expect(titles).toEqual(['Site report: Leeds', 'Site report: York']);
  });

  it('REU-051 makes every row from the template as it was resolved when the cohort was asked for', async () => {
    const stored = await template('Findings');
    const { cohort } = await submitted(stored.id, [{ site: 'Leeds' }, { site: 'York' }]);
    // The template changes before any row is made.
    const changed = await as((trx) =>
      recordTemplateVersion(trx, {
        templateId: stored.id,
        openedFrom: stored.version.id,
        definition: definition('Results'),
        author: ada,
      }),
    );
    expect(changed.answer).toBe('recorded');
    const made: StoredCohort = await run(cohort.id);
    const outlines = await as(async (trx) =>
      Promise.all(
        made.rows.map(
          async (each) => (await latestVersion(trx, each.document!))!.content as OutlineDocument,
        ),
      ),
    );
    expect(
      outlines.map((outline) => outline.nodes.map((node) => node.type === 'section' && node.title)),
    ).toEqual([
      [[{ type: 'text', value: 'Findings', marks: [] }]],
      [[{ type: 'text', value: 'Findings', marks: [] }]],
    ]);
    expect(made.template).toEqual({ id: stored.id, version: stored.version.id });
  });

  it('REU-035 runs the failed rows again, corrected, and never touches a row that was made', async () => {
    const { cohort } = await submitted((await template()).id, [
      { site: 'Leeds' },
      { site: 'Bath' },
    ]);
    const first = await run(cohort.id);
    const kept = first.rows[0]!;
    expect(
      await as((trx) => rerunCohort(trx, cohort.id, ada, { 1: { site: 'York' } })),
    ).toMatchObject({
      answer: 'rows.invalid',
    });
    const again = await as((trx) => rerunCohort(trx, cohort.id, ada, { 2: { site: 'Hull' } }));
    expect(again).toMatchObject({ answer: 'submitted', job: { parameters: { rows: 1 } } });
    const after = await run(cohort.id);
    expect(after.rows[0]).toEqual(kept);
    expect(after.rows[1]).toMatchObject({
      state: 'made',
      attempts: 2,
      parameters: { site: 'Hull' },
    });
    expect(await as((trx) => rerunCohort(trx, cohort.id, ada))).toEqual({ answer: 'none.failed' });
  });

  it('refuses a cohort of no rows, or a template that cannot be read, writing nothing', async () => {
    const stored = await template();
    const ask = (templateId: string, rows: Record<string, unknown>[]) =>
      as((trx) =>
        submitCohort(trx, {
          by: ada,
          spaceId: general,
          template: templateId,
          title: '{site}',
          language: 'en-GB',
          direction: 'ltr',
          rows,
          source: { rows: rows.length },
        }),
      );
    expect(await ask(stored.id, [])).toEqual({ answer: 'rows.invalid', detail: 'none' });
    expect(await ask('00000000-0000-4000-8000-000000000000', [{ site: 'Leeds' }])).toEqual({
      answer: 'template.missing',
    });
  });

  it('titles each document from its pattern', () => {
    expect(titleFor('{site} report, {year}', { site: 'Leeds', year: '2026' })).toBe(
      'Leeds report, 2026',
    );
    expect(titleFor('{sites}', { sites: ['Leeds', 'York'] })).toBe('Leeds, York');
  });
});
