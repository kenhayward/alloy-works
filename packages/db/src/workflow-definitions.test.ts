import { randomUUID } from 'node:crypto';
import {
  defaultLimits,
  SEED_WORKFLOW,
  type ConnectionSettings,
  type QueryDefinition,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createConnection } from './connections.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import {
  createQueryDefinition,
  recordQueryDefinitionVersion,
  type StoredQueryDefinition,
} from './queryDefinitions.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { listWorkflows, moveArtifact, workflowStanding } from './workflow.js';
import { decideGate } from './workflow-gates.js';

const settings: ConnectionSettings = {
  schemaVersion: 1,
  name: 'Readings',
  description: '',
  type: 'postgres',
  source: {
    host: 'source-postgres',
    port: 5432,
    database: 'readings',
    account: 'reader',
    tls: 'require',
  },
  identity: { kind: 'service' },
  retired: false,
};

/**
 * Query definitions under a workflow of their own (DAT-121; the WF2 plan, WF2-K): reviewed and
 * approved as content is, by the same gates.
 */
describe('a query definition reviewed as content is (workflow.md)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let space = '';
  let definition: StoredQueryDefinition;

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

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
      space = (await createSpace(trx, `Space ${randomUUID()}`)).id;
      const person = async (name: string) =>
        (
          await trx
            .insertInto('principal')
            .values({
              issuer: 'https://idp.example',
              subject: randomUUID(),
              email: null,
              display_name: name,
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      ada = await person('Ada');
      grace = await person('Grace');
      const connection = await createConnection(trx, { author: ada, spaceId: space, settings });
      if (connection.answer !== 'created') throw new Error(connection.answer);
      const body: QueryDefinition = {
        schemaVersion: 1,
        title: 'Depth by site',
        description: '',
        connection: connection.connection.id,
        parameters: [],
        fetch: { kind: 'sql', text: 'select id, depth from sample.reading order by id' },
        columns: [
          { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
          { name: 'depth', from: { column: 'depth' }, type: { base: 'text' } },
        ],
        key: ['id'],
        order: [{ column: 'id', direction: 'ascending' }],
        empty: 'valid',
        limits: { ...defaultLimits },
        retired: false,
      };
      const made = await createQueryDefinition(trx, { author: ada, spaceId: space, definition: body });
      if (made.answer !== 'created') throw new Error(made.answer);
      definition = made.definition;
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('DAT-121 starts a query definition in its own workflow, passes its gate by an approver, and a change after starts a draft', async () => {
    expect(
      (await as((trx) => listWorkflows(trx))).map((each) => [
        each.definition.kind,
        each.definition.body,
      ]),
    ).toContainEqual(['queryDefinition', SEED_WORKFLOW]);
    expect(await as((trx) => workflowStanding(trx, definition.id))).toMatchObject({
      kind: 'queryDefinition',
      state: { key: 'draft' },
    });
    await as((trx) =>
      moveArtifact(trx, {
        artifactId: definition.id,
        kind: 'queryDefinition',
        transition: 'submit',
        from: 'draft',
        by: ada,
        may: () => true,
      }),
    );
    expect(
      await as((trx) =>
        decideGate(trx, {
          artifactId: definition.id,
          kind: 'queryDefinition',
          transition: 'approve',
          version: definition.version.id,
          decision: 'approved',
          by: grace,
          may: () => true,
        }),
      ),
    ).toMatchObject({ answer: 'passed', revision: 1, standing: { state: { key: 'approved' } } });

    const changed = await as((trx) =>
      recordQueryDefinitionVersion(trx, {
        author: ada,
        id: definition.id,
        openedFrom: definition.version.id,
        definition: { ...definition.definition, title: 'Depth by site, in metres' },
      }),
    );
    expect(changed.answer).toBe('recorded');
    expect(await as((trx) => workflowStanding(trx, definition.id))).toMatchObject({
      state: { key: 'draft' },
      revision: { number: 1, versionId: definition.version.id },
    });
  });
});
