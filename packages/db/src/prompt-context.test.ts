import { randomBytes, randomUUID } from 'node:crypto';
import {
  blockIdentifierFrom,
  DEFINITION_SCHEMA_VERSION,
  type OutlineDocument,
  type OutlineNode,
  type Prompt,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDefinition } from './definitions.js';
import { createDocument } from './documents.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { resolveContext } from './prompt-context.js';
import { createTenant, type Tenant } from './provision.js';
import { makeRelationship } from './relationships.js';
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
import { recordVersion } from './versions.js';

const node = () => blockIdentifierFrom(randomBytes(16));

const reference = (component: string, id = node()): OutlineNode => ({
  type: 'reference',
  id,
  component,
  mode: { kind: 'latest' },
  numbered: true,
  matter: 'body',
  pageBreak: 'none',
  values: {},
  children: [],
});

const section = (children: OutlineNode[]): OutlineNode =>
  ({
    type: 'section',
    id: node(),
    title: [{ type: 'text', value: 'A section', marks: [] }],
    numbered: true,
    matter: 'body',
    pageBreak: 'none',
    values: {},
    children,
  }) as unknown as OutlineNode;

const prompt = (context: Prompt['context']): Prompt => ({
  schemaVersion: 1,
  title: 'Plain words',
  description: '',
  instructions: 'Rewrite it.',
  context,
  output: { componentType: null },
  models: { purpose: 'drafting', accepts: ['m'] },
});

describe("a prompt's context resolved (the G4 plan, G4-H)", () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let shared = '';
  let restricted = '';
  let cites = '';
  const parts: Record<string, string> = {};
  const nodes: Record<string, string> = {};
  let documentId = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  const component = (space: string, title: string) =>
    as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version.artifactId;
    });

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
      shared = (await createSpace(trx, 'Shared')).id;
      restricted = (await createSpace(trx, 'Restricted')).id;
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
      // Ada authors in both; Grace in Shared alone.
      for (const [who, space] of [
        [ada, shared],
        [ada, restricted],
        [grace, shared],
      ] as const) {
        await grant(trx, {
          roleId: (await findRole(trx, 'Author'))!.id,
          subject: { principal: who },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: who,
        });
      }
      const type = await createDefinition(trx, {
        kind: 'relationshipType',
        definition: {
          schemaVersion: DEFINITION_SCHEMA_VERSION,
          name: 'Cites',
          inverseName: 'Cited by',
          directed: true,
          from: { kinds: ['component'], cardinality: 'many', permission: 'read' },
          to: { kinds: ['component'], cardinality: 'many', permission: 'read' },
          selfReference: false,
          acyclic: false,
          informational: true,
          schemas: [],
        },
        author: ada,
      });
      if (type.answer !== 'created') throw new Error(type.answer);
      cites = type.definition.id;
    });
    for (const [key, space] of [
      ['written', shared],
      ['sibling', shared],
      ['elsewhere', shared],
      ['hidden', restricted],
      ['source', shared],
      ['secretSource', restricted],
    ] as const) {
      parts[key] = await component(space, key);
    }
    for (const [to, as_] of [
      ['source', ada],
      ['secretSource', ada],
    ] as const) {
      await as(async (trx) => {
        const made = await makeRelationship(trx, {
          by: as_,
          type: cites,
          from: { artifact: parts.written! },
          to: { artifact: parts[to]! },
        });
        if (made.answer !== 'made') throw new Error(made.answer);
      });
    }
    for (const key of ['written', 'sibling', 'elsewhere', 'hidden']) nodes[key] = node();
    documentId = await as(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: shared,
        title: 'Report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const outline: OutlineDocument = {
        ...(made.version.content as OutlineDocument),
        nodes: [
          section([
            reference(parts.written!, nodes.written),
            reference(parts.sibling!, nodes.sibling),
            reference(parts.hidden!, nodes.hidden),
          ]),
          section([reference(parts.elsewhere!, nodes.elsewhere)]),
        ],
      };
      const recorded = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ada,
        substance: { kind: 'document', content: outline },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return made.version.artifactId;
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  const resolved = (principal: string, context: Prompt['context'], at = nodes.written!) =>
    as((trx) => resolveContext(trx, { principal, documentId, node: at, prompt: prompt(context) }));
  const componentsOf = (answer: Awaited<ReturnType<typeof resolved>>) =>
    answer.answer === 'resolved'
      ? answer.context.parts.map((each) => each.component)
      : answer.answer;

  it('GEN-056 resolves the part, its section, the whole document and the components related to it', async () => {
    expect(componentsOf(await resolved(ada, [{ source: 'outline', scope: 'part' }]))).toEqual([
      parts.written,
    ]);
    expect(componentsOf(await resolved(ada, [{ source: 'outline', scope: 'section' }]))).toEqual([
      parts.written,
      parts.sibling,
      parts.hidden,
    ]);
    expect(componentsOf(await resolved(ada, [{ source: 'outline', scope: 'document' }]))).toEqual([
      parts.written,
      parts.sibling,
      parts.hidden,
      parts.elsewhere,
    ]);
    expect(
      componentsOf(
        await resolved(ada, [
          { source: 'outline', scope: 'part' },
          { source: 'related', type: cites, direction: 'out' },
        ]),
      ),
    ).toEqual([parts.written, parts.source, parts.secretSource]);
  });

  it('GEN-058 leaves out, unflagged, every part and related component the runner may not read', async () => {
    expect(componentsOf(await resolved(grace, [{ source: 'outline', scope: 'document' }]))).toEqual(
      [parts.written, parts.sibling, parts.elsewhere],
    );
    expect(
      componentsOf(
        await resolved(grace, [
          { source: 'outline', scope: 'part' },
          { source: 'related', type: cites, direction: 'out' },
        ]),
      ),
    ).toEqual([parts.written, parts.source]);
    // A part they may not read is no part to run on.
    expect(await resolved(grace, [{ source: 'outline', scope: 'part' }], nodes.hidden)).toEqual({
      answer: 'part.missing',
    });
  });

  it('GEN-057 GEN-059 records each part by version and block, and refuses a declaration that resolves to nothing', async () => {
    const answer = await resolved(ada, [{ source: 'outline', scope: 'part' }]);
    expect(answer.answer === 'resolved' && answer.record).toEqual([
      { component: parts.written, version: expect.any(String), blocks: [expect.any(String)] },
    ]);
    expect(await resolved(ada, [{ source: 'related', type: cites, direction: 'in' }])).toEqual({
      answer: 'context.empty',
    });
    expect(await resolved(ada, [{ source: 'parameters', names: ['audience'] }])).toEqual({
      answer: 'context.empty',
    });
  });
});
