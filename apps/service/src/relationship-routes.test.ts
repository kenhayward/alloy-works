import { findRole, grant } from '@alloy-works/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './test/bindings-harness.js';

type Json = Record<string, unknown>;

/** Relationships through the service (the R8 plan, R8-A, R8-D, R8-E). */
describe('relationships, through the service', () => {
  let h: Harness;
  let supersedes = '';

  beforeAll(async () => {
    h = await startHarness();
    // The environment's own manager of definitions, as a tenant grants one.
    await h.tenantDb.withTenant(h.tenant, async (trx) =>
      grant(trx, {
        roleId: (await findRole(trx, 'Definitions manager'))!.id,
        subject: { principal: h.ids.ada! },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: h.ids.ada!,
      }),
    );
    // Ada manages the environment's definitions: she declares the type through the service (REL-005).
    const made = await h.call('ada', 'POST', '/v1/definitions', {
      kind: 'relationshipType',
      definition: {
        schemaVersion: 1,
        name: 'Supersedes',
        inverseName: 'Superseded by',
        directed: true,
        from: { kinds: ['document'], cardinality: 'many', permission: 'edit' },
        to: { kinds: ['document'], cardinality: 'many', permission: 'read' },
        selfReference: false,
        acyclic: true,
        informational: true,
        schemas: [],
      },
    });
    expect(made.statusCode, made.body).toBe(200);
    supersedes = made.json<{ id: string }>().id;
  });

  afterAll(async () => {
    await h?.close();
  });

  const relate = (user: string, from: string, to: string) =>
    h.call(user, 'POST', '/v1/relationships', {
      type: supersedes,
      from: { artifact: from },
      to: { artifact: to },
    });

  it('REL-005 REL-035 relates two documents by a type an administrator declared, needing the permission it asks at each end', async () => {
    const [older, newer] = [await h.documentReferencing([]), await h.documentReferencing([])];
    // Alice reads General and may not edit there: the type asks edit at the from end.
    expect((await relate('alice', newer.id, older.id)).statusCode).toBe(403);
    // Ivy reads nothing: neither end is there for her.
    expect((await relate('ivy', newer.id, older.id)).statusCode).toBe(404);
    const made = await relate('ada', newer.id, older.id);
    expect(made.statusCode, made.body).toBe(200);
    const relationship = made.json<Json & { id: string }>();
    expect(relationship).toMatchObject({
      type: supersedes,
      from: { artifact: newer.id, kind: 'document', version: null },
      to: { artifact: older.id, kind: 'document', version: null },
    });
    // Reading it needs read on both ends alone.
    expect((await h.call('alice', 'GET', `/v1/relationships/${relationship.id}`)).statusCode).toBe(
      200,
    );
    expect((await h.call('ivy', 'GET', `/v1/relationships/${relationship.id}`)).statusCode).toBe(
      404,
    );
  });

  it('REL-046 refuses a cycle by name, and removes a relationship, answering it as it was', async () => {
    const [a, b] = [await h.documentReferencing([]), await h.documentReferencing([])];
    const made = await relate('ada', a.id, b.id);
    expect(made.statusCode, made.body).toBe(200);
    const back = await relate('ada', b.id, a.id);
    expect(back.statusCode).toBe(409);
    expect(back.json()).toMatchObject({ code: 'relationship_cycle' });
    const id = made.json<{ id: string }>().id;
    const removed = await h.call('ada', 'DELETE', `/v1/relationships/${id}`);
    expect(removed.statusCode, removed.body).toBe(200);
    expect((await h.call('ada', 'GET', `/v1/relationships/${id}`)).statusCode).toBe(404);
  });
});
