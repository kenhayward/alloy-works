import { randomBytes, randomUUID } from 'node:crypto';
import {
  blockIdentifierFrom,
  DEFINITION_SCHEMA_VERSION,
  type OutlineDocument,
  type OutlineNode,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDefinition } from './definitions.js';
import { createDocument } from './documents.js';
import { grant } from './grants.js';
import { impact } from './impact.js';
import { migrate } from './migrate.js';
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
import { neighbours, shortestPath } from './traversal.js';
import { recordVersion } from './versions.js';

const reference = (component: string): OutlineNode => ({
  type: 'reference',
  id: blockIdentifierFrom(randomBytes(16)),
  component,
  mode: { kind: 'latest' },
  numbered: true,
  matter: 'body',
  pageBreak: 'none',
  values: {},
  children: [],
});

describe('traversal over references and relationships (the R8 plan, R8-F)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let shared = '';
  let restricted = '';
  let supersedes = '';
  let relates = '';
  let basis = '';
  let grounds = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  const document = (space: string, title: string, nodes: OutlineNode[] = []) =>
    as(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: grace,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      if (nodes.length === 0) return made.version.artifactId;
      const outline: OutlineDocument = { ...(made.version.content as OutlineDocument), nodes };
      const recorded = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: grace,
        substance: { kind: 'document', content: outline },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return made.version.artifactId;
    });

  const relate = (type: string, from: string, to: string, values?: Record<string, unknown>) =>
    as(async (trx) => {
      const made = await makeRelationship(trx, {
        by: grace,
        type,
        from: { artifact: from },
        to: { artifact: to },
        ...(values ? { values } : {}),
      });
      if (made.answer !== 'made') throw new Error(made.answer);
      return made.relationship.id;
    });

  const declare = (over: Record<string, unknown>) =>
    as(async (trx) => {
      const made = await createDefinition(trx, {
        kind: 'relationshipType',
        definition: {
          schemaVersion: DEFINITION_SCHEMA_VERSION,
          name: `Type ${randomUUID().slice(0, 8)}`,
          inverseName: 'Inverse',
          directed: true,
          from: { kinds: ['document'], cardinality: 'many', permission: 'read' },
          to: { kinds: ['document'], cardinality: 'many', permission: 'read' },
          selfReference: false,
          acyclic: false,
          informational: true,
          schemas: [],
          ...over,
        },
        author: grace,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.definition.id;
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
      for (const [who, space] of [
        [ada, shared],
        [grace, shared],
        [grace, restricted],
      ] as const) {
        await grant(trx, {
          roleId: (await findRole(trx, 'Author'))!.id,
          subject: { principal: who },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: who,
        });
      }
      const field = await createDefinition(trx, {
        kind: 'field',
        definition: {
          schemaVersion: DEFINITION_SCHEMA_VERSION,
          name: 'Basis',
          dataType: 'text',
          multiplicity: 'one',
          validation: {},
        },
        author: grace,
      });
      if (field.answer !== 'created') throw new Error(field.answer);
      basis = field.definition.id;
      const schema = await createDefinition(trx, {
        kind: 'metadataSchema',
        definition: {
          schemaVersion: DEFINITION_SCHEMA_VERSION,
          name: 'Grounds',
          entries: [{ field: basis, required: false, fixed: false }],
        },
        author: grace,
      });
      if (schema.answer !== 'created') throw new Error(schema.answer);
      grounds = schema.definition.id;
    });
    supersedes = await declare({
      name: 'Supersedes',
      schemas: [{ schema: grounds, requires: [] }],
    });
    relates = await declare({ name: 'Relates to', directed: false });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('REL-022 REL-023 walks references and relationships together, a reference chain hard and anything a relationship reaches informational', async () => {
    const step = await as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: shared,
        title: 'Step',
        language: 'en-GB',
        direction: 'ltr',
        author: grace,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version.artifactId;
    });
    const procedure = await document(shared, 'Procedure', [reference(step)]);
    const successor = await document(shared, 'Successor');
    const peer = await document(shared, 'Peer');
    await relate(supersedes, successor, procedure);
    // An undirected type reads the same from both ends: the procedure is its from end here.
    await relate(relates, procedure, peer);

    const walked = await as((trx) => impact(trx, ada, step, 3));
    expect(walked.reached.map(({ id, depth, hard }) => ({ id, depth, hard }))).toEqual(
      expect.arrayContaining([
        { id: procedure, depth: 1, hard: true },
        { id: successor, depth: 2, hard: false },
        { id: peer, depth: 2, hard: false },
      ]),
    );
    expect(walked.reached).toHaveLength(3);
  });

  it('REL-015 answers the neighbours of an artifact by type, by direction and by the value of a field, leaving out an unreadable one and saying so', async () => {
    const centre = await document(shared, 'Centre');
    const [older, newer, hidden] = [
      await document(shared, 'Older'),
      await document(shared, 'Newer'),
      await document(restricted, 'Hidden'),
    ];
    await relate(supersedes, centre, older, { [basis]: 'Revised' });
    await relate(supersedes, newer, centre);
    await relate(relates, centre, hidden);

    const all = await as((trx) => neighbours(trx, ada, centre));
    expect(all.items.map((each) => [each.other.title, each.direction])).toEqual([
      ['Older', 'out'],
      ['Newer', 'in'],
    ]);
    expect(all.cut).toBe(true);
    expect((await as((trx) => neighbours(trx, grace, centre))).cut).toBe(false);

    const out = await as((trx) =>
      neighbours(trx, ada, centre, { type: supersedes, direction: 'out' }),
    );
    expect(out.items.map((each) => each.other.id)).toEqual([older]);
    const inward = await as((trx) => neighbours(trx, ada, centre, { direction: 'in' }));
    expect(inward.items.map((each) => each.other.id)).toEqual([newer]);
    const byValue = await as((trx) =>
      neighbours(trx, ada, centre, { field: { id: basis, value: 'Revised' } }),
    );
    expect(byValue.items.map((each) => each.other.id)).toEqual([older]);
    expect(
      (await as((trx) => neighbours(trx, ada, centre, { field: { id: basis, value: 'Other' } })))
        .items,
    ).toEqual([]);
  });

  it('REL-029 finds a shortest path to a declared depth, along named types if asked, matching a breadth-first search over a generated graph', async () => {
    // A seeded graph of twelve documents, one of them unreadable to Ada.
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const nodes: string[] = [];
    for (let at = 0; at < 12; at += 1) {
      nodes.push(await document(at === 5 ? restricted : shared, `Node ${at}`));
    }
    const edges: [number, number, string][] = [];
    for (let at = 0; at < 18; at += 1) {
      const a = Math.floor(next() * 12);
      const b = Math.floor(next() * 12);
      if (a === b || edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) continue;
      const type = next() < 0.5 ? supersedes : relates;
      await relate(type, nodes[a]!, nodes[b]!);
      edges.push([a, b, type]);
    }
    /** The least hops from `a` to `b` in the test's own graph, either direction along each edge. */
    const bfs = (a: number, b: number, types: string[] | null, skip: number | null) => {
      const distance = new Map([[a, 0]]);
      const queue = [a];
      while (queue.length > 0) {
        const at = queue.shift()!;
        for (const [x, y, type] of edges) {
          if (types && !types.includes(type)) continue;
          const other = x === at ? y : y === at ? x : null;
          if (other === null || other === skip || distance.has(other)) continue;
          distance.set(other, distance.get(at)! + 1);
          queue.push(other);
        }
      }
      return distance.get(b) ?? null;
    };

    const lengths: (number | null)[] = [];
    for (const [a, b] of [
      [0, 11],
      [1, 7],
      [2, 9],
      [3, 10],
      [4, 8],
    ] as const) {
      for (const types of [null, [relates]]) {
        for (const [who, skip] of [
          [grace, null],
          [ada, 5],
        ] as const) {
          const expected = bfs(a, b, types, skip);
          lengths.push(expected);
          const found = await as((trx) => shortestPath(trx, who, nodes[a]!, nodes[b]!, 10, types));
          expect(found.path === null ? null : found.path.length - 1, `${a} to ${b}`).toBe(expected);
          if (found.path) {
            expect(found.path[0]!.id).toBe(nodes[a]);
            expect(found.path.at(-1)!.id).toBe(nodes[b]);
            if (who === ada) expect(found.path.map((each) => each.id)).not.toContain(nodes[5]);
          }
          // A shorter depth than the path needs finds none.
          if (expected !== null && expected > 1) {
            const short = await as((trx) =>
              shortestPath(trx, who, nodes[a]!, nodes[b]!, expected - 1, types),
            );
            expect(short.path).toBeNull();
          }
        }
      }
    }
    // Not vacuous: some pairs join only past one hop, and some not at all for Ada.
    expect(lengths.some((each) => each !== null && each > 1)).toBe(true);
    expect(lengths).toContain(null);
  });

  it('REL-020 says a path was cut where it met an artifact the caller may not read, naming nothing of it', async () => {
    const [start, end] = [await document(shared, 'Start'), await document(shared, 'End')];
    const between = await document(restricted, 'Between');
    await relate(relates, start, between);
    await relate(relates, between, end);
    expect(await as((trx) => shortestPath(trx, grace, start, end, 3))).toMatchObject({
      path: [{ id: start }, { id: between }, { id: end }],
      cut: false,
    });
    expect(await as((trx) => shortestPath(trx, ada, start, end, 3))).toEqual({
      path: null,
      cut: true,
    });
  });
});
