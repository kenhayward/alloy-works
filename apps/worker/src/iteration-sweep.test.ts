import { randomUUID } from 'node:crypto';
import {
  claimLock,
  createArtifact,
  createTenant,
  cutVersion,
  migrate,
  prepareDatabase,
  saveIteration,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  queryAs,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import {
  DEFINITION_SCHEMA_VERSION,
  definitionsFor,
  type ComponentTypeDefinition,
  type ContentDocument,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sweepExpiredIterations } from './sweep.js';
import type { WorkerLog } from './worker.js';

const content = (text: string): ContentDocument => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    {
      type: 'paragraph',
      id: 'b1',
      style: 'body',
      content: [{ type: 'text', value: text, marks: [] }],
    },
  ],
});

describe('sweeping iterations past their window, in every tenant', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let tenants: Tenant[];

  beforeAll(async () => {
    db = await freshDatabase();
    await prepareDatabase(db.adminUrl);
    await migrate(db.migratorUrl);
    tenants = [];
    for (const [name, host] of [
      ['Production', 'acme.alloy.test'],
      ['Development', 'dev.acme.alloy.test'],
      ['Training', 'training.acme.alloy.test'],
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
  });

  afterAll(async () => {
    await service?.close();
    await worker?.close();
    await db?.drop();
  });

  /**
   * In this tenant, a component Ada saved twice and then made a version of, and saved once more
   * after: the two iterations before the cut, whose window is then set as passed, and the one after,
   * which nothing has been cut after.
   */
  const iterationsIn = async (tenant: Tenant) => {
    const made = await service.withTenant(tenant, async (trx) => {
      const ada = await trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const general = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      const type: ComponentTypeDefinition = {
        schemaVersion: DEFINITION_SCHEMA_VERSION,
        id: randomUUID(),
        name: 'Procedure',
        assignments: [],
      };
      const stored = await createArtifact(trx, {
        author: ada.id,
        substance: { kind: 'componentType', content: type },
      });
      const component = await createArtifact(trx, {
        author: ada.id,
        spaceId: general.id,
        substance: {
          kind: 'component',
          content: content('Unbox the printer.'),
          values: {},
          notCarried: [],
          definitions: definitionsFor({ version: stored.id, definition: type }, [], []),
        },
      });
      const session = randomUUID();
      const editing = { artifactId: component.artifactId, principal: ada.id, session };
      await claimLock(trx, editing);
      let openedFrom = component.id;
      const texts = ['Plug it in.', 'Plug it in and switch it on.', 'Load the paper.'];
      for (const [index, text] of texts.entries()) {
        if (index === 2) {
          const cut = await cutVersion(trx, { ...editing, openedFrom });
          if (cut.answer !== 'recorded') throw new Error(cut.answer);
          openedFrom = cut.version.id;
        }
        const saved = await saveIteration(trx, {
          ...editing,
          sequence: index + 1,
          openedFrom,
          content: content(text),
        });
        if (saved.answer !== 'accepted') throw new Error(saved.answer);
      }
      return { next: openedFrom };
    });
    await queryAs(
      db.adminUrl,
      `update "${tenant.schema}".artifact_version
          set created_at = now() - interval '31 days' where id = $1`,
      [made.next],
    );
  };

  /** Each iteration left in the tenant, by its sequence. */
  const left = async (tenant: Tenant) => {
    const { rows } = await queryAs(
      db.adminUrl,
      `select sequence from "${tenant.schema}".iteration order by sequence`,
    );
    return rows.map((row: { sequence: number }) => row.sequence);
  };

  it('VER-003 removes the iterations past their window in every tenant, and one tenant failing does not stop the rest', async () => {
    for (const tenant of tenants) await iterationsIn(tenant);
    // The first tenant the sweep reaches fails: its role may no longer delete an iteration.
    const first = (await worker.tenants())[0]!;
    const failing = tenants.find((tenant) => tenant.id === first.id)!;
    const swept = tenants.filter((tenant) => tenant !== failing);
    await queryAs(
      db.adminUrl,
      `revoke delete on "${failing.schema}".iteration from "${failing.role}"`,
    );
    const errors: object[] = [];
    const log: WorkerLog = {
      info: () => {},
      warn: () => {},
      error: (details) => errors.push(details),
    };

    expect(await sweepExpiredIterations(worker, log)).toBe(2 * swept.length);

    for (const tenant of swept) expect(await left(tenant), tenant.id).toEqual([3]);
    expect(await left(failing)).toEqual([1, 2, 3]);
    expect(errors).toEqual([expect.objectContaining({ tenant: failing.id })]);
  });
});
