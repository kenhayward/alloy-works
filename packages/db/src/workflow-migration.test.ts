import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  blockIdentifierFrom,
  SEED_DOCUMENT_WORKFLOW,
  SEED_PROMPT_WORKFLOW,
  SEED_WORKFLOW,
  SEED_WORKFLOW_1,
  type OutlineDocument,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDocument } from './documents.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { provisionTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { searchWords } from './search-words.js';
import {
  beforeTheLogDatabase,
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
} from './testing/database.js';
import { recordVersion } from './versions.js';
import { defineWorkflow, listWorkflows, workflowStanding, workflowVersion } from './workflow.js';

const words = (value: string) => [{ type: 'text' as const, value, marks: [] }];

/**
 * Migration 0095: every component and document an environment holds starts in draft under each kind's
 * seeded version 1, at its latest version, and search holds the state on its rows and its history.
 */
describe('migration 0095, which gives every component and document a workflow state', () => {
  let db: TestDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration up to 0094 and none after.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0095-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 95;
      },
    });
  });

  afterAll(async () => {
    await rm(before, { recursive: true, force: true });
    await db?.drop();
  });

  it('LIF-007 SCH-060 backfills each in draft under version 1, at its latest version, found by its state', async () => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const provisioned = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Demonstration' },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const tenant: Tenant = { ...provisioned, id };
    const service = beforeTheLogDatabase(db.serviceUrl);
    try {
      // Made with today's code on the schema before 0095, which writes no workflow.
      const made = await service.withTenant(tenant, async (trx) => {
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
        const space = (
          await trx
            .selectFrom('space')
            .select('id')
            .where('name', '=', 'General')
            .executeTakeFirstOrThrow()
        ).id;
        await grant(trx, {
          roleId: (await findRole(trx, 'Reader'))!.id,
          subject: { principal: ada },
          level: { kind: 'tenant' },
          effect: 'allow',
          grantedBy: ada,
        });
        const component = await createComponent(trx, {
          spaceId: space,
          title: 'Numbat sightings',
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
        });
        if (component.answer !== 'created') throw new Error(component.answer);
        const document = await createDocument(trx, {
          spaceId: space,
          title: 'Numbat survey',
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
        });
        if (document.answer !== 'created') throw new Error(document.answer);
        const later = await recordVersion(trx, {
          artifactId: document.version.artifactId,
          openedFrom: document.version.id,
          author: ada,
          substance: {
            kind: 'document',
            content: {
              ...(document.version.content as OutlineDocument),
              nodes: [
                {
                  type: 'section',
                  id: blockIdentifierFrom(randomBytes(16)),
                  title: words('Numbat range'),
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
        if (later.answer !== 'recorded') throw new Error(later.answer);
        return { ada, component: component.version, document: later.version };
      });

      await migrate(db.migratorUrl);

      await service.withTenant(tenant, async (trx) => {
        expect((await listWorkflows(trx)).map((each) => each.definition.body)).toEqual([
          SEED_WORKFLOW,
          SEED_DOCUMENT_WORKFLOW,
          SEED_WORKFLOW,
          SEED_PROMPT_WORKFLOW,
        ]);
        // Backfilled under version 1; the newest, 0096's and 0097's, has draft, so it now decides (WF-E).
        for (const [version, newest] of [
          [made.component, 2],
          [made.document, 3],
        ] as const) {
          expect(await workflowStanding(trx, version.artifactId)).toMatchObject({
            state: { key: 'draft' },
            definition: { version: newest },
            version: version.id,
          });
        }
        const rows = await trx
          .selectFrom('workflow_transition')
          .select(['by', 'transition', 'from_state'])
          .execute();
        expect(rows).toEqual([
          { by: made.ada, transition: null, from_state: null },
          { by: made.ada, transition: null, from_state: null },
        ]);
        for (const scope of ['latest', 'all'] as const) {
          const found = await searchWords(trx, made.ada, 'numbat', {
            scope,
            filters: { states: ['draft'] },
          });
          if (found?.outcome !== 'results') throw new Error(found?.outcome);
          expect(found.items.map((item) => item.kind).sort(), scope).toEqual([
            'component',
            'document',
            'section',
          ]);
        }
      });
    } finally {
      await service.close();
    }
  });
});

/**
 * Migration 0096: a tenant whose workflows are still the seed's version 1 gains its version 2, Approve
 * a gate; a tenant that edited its own keeps it, and gains no gate.
 */
describe('migration 0096, which seeds a gate where a workflow was never edited', () => {
  let db: TestDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    before = await mkdtemp(join(tmpdir(), 'aw-before-0096-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 96;
      },
    });
  });

  afterAll(async () => {
    await rm(before, { recursive: true, force: true });
    await db?.drop();
  });

  it("LIF-003 seeds version 2 with its gate only where a kind's newest is still version 1", async () => {
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const tenants: Tenant[] = [];
    for (const name of ['Untouched', 'Edited']) {
      const id = db.newTenantId();
      const provisioned = await provisionTenant(db.adminUrl, {
        organisation: { id: 'acme', name: 'Acme' },
        tenant: { id, name },
        hostnames: [`${id}.alloy.test`],
      });
      tenants.push({ ...provisioned, id });
    }
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const service = beforeTheLogDatabase(db.serviceUrl);
    const renamed = {
      ...SEED_WORKFLOW_1,
      states: SEED_WORKFLOW_1.states.map((each) =>
        each.key === 'draft' ? { ...each, name: 'Working' } : each,
      ),
    };
    try {
      await service.withTenant(tenants[1]!, async (trx) => {
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
        await defineWorkflow(trx, { kind: 'document', body: renamed, by: ada });
      });

      await migrate(db.migratorUrl);

      const newest = async (tenant: Tenant) =>
        service.withTenant(tenant, async (trx) =>
          (await listWorkflows(trx)).map((each) => [each.definition.version, each.definition.body]),
        );
      expect(await newest(tenants[0]!)).toEqual([
        [2, SEED_WORKFLOW],
        [3, SEED_DOCUMENT_WORKFLOW],
        [1, SEED_WORKFLOW],
        [2, SEED_PROMPT_WORKFLOW],
      ]);
      expect(await newest(tenants[1]!)).toEqual([
        [2, SEED_WORKFLOW],
        [2, renamed],
        [1, SEED_WORKFLOW],
        [2, SEED_PROMPT_WORKFLOW],
      ]);
      await service.withTenant(tenants[1]!, async (trx) => {
        expect((await workflowVersion(trx, 'document', 1))?.body).toEqual(SEED_WORKFLOW_1);
      });
    } finally {
      await service.close();
    }
  });
});
