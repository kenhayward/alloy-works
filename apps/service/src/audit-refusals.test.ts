import { queryAs } from '@alloy-works/db/testing';
import { removeGrant } from '@alloy-works/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { binding, HOST, ranOk, startHarness, type Harness } from './test/bindings-harness.js';

type Json = Record<string, unknown>;

/** The refused authorisations the audit log records (IAM-013; the AU1 plan, AU1-E). */
describe('refusals in the audit log', () => {
  let h: Harness;
  let connection: { id: string; version: string };

  beforeAll(async () => {
    h = await startHarness();
    connection = await h.connection('Readings');
  });

  afterAll(async () => {
    await h?.close();
  });

  const newest = async () =>
    (
      await queryAs(
        h.db.adminUrl,
        `select coalesce(max(sequence), 0)::text as newest from ${h.tenant.schema}.audit_event`,
      )
    ).rows[0]!.newest as string;

  /** Every event since `after`, each with its labels by role. */
  const eventsAfter = async (after: string) => {
    const { rows } = await queryAs(
      h.db.adminUrl,
      `select e.*, coalesce((select jsonb_object_agg(l.role, l.text) from ${h.tenant.schema}.audit_label l
                              where l.sequence = e.sequence), '{}') as labels
       from ${h.tenant.schema}.audit_event e where e.sequence > $1 order by e.sequence`,
      [after],
    );
    return rows as Json[];
  };

  const ALICE = 'alice';

  it('IAM-013 records a refused authorisation by session with its permission, target and rule', async () => {
    const mark = await newest();
    const answer = await h.call(ALICE, 'POST', `/v1/spaces/${h.general}/components`, {
      title: 'Not hers to make',
      language: 'en-GB',
      direction: 'ltr',
    });
    expect(answer.statusCode, answer.body).toBe(403);
    const events = await eventsAfter(mark);
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'access.refused',
        outcome: 'refused',
        actor_kind: 'person',
        actor: h.ids.alice,
        token: null,
        subject_kind: 'space',
        subject: h.general,
        space: h.general,
        trace_id: answer.headers['x-request-id'],
        detail: {
          permission: 'create',
          target: `space:${h.general}`,
          reason: 'not_granted',
          level: null,
          hidden: false,
          code: 'forbidden',
        },
        labels: { actor: expect.any(String), subject: 'General' },
      }),
    ]);
  });

  it('IAM-013 records a hidden 404 as hidden, and an unknown target not at all', async () => {
    const secret = await h.component(h.quality, 'Quality plan');
    const mark = await newest();
    const hidden = await h.call(ALICE, 'GET', `/v1/components/${secret.id}`);
    expect(hidden.statusCode).toBe(404);
    const nobody = await h.call(
      ALICE,
      'GET',
      '/v1/components/11111111-1111-4111-8111-111111111111',
    );
    expect(nobody.statusCode).toBe(404);
    // The two answers are alike; only the first is a refusal.
    expect(nobody.json<Json>().code).toBe(hidden.json<Json>().code);
    const events = await eventsAfter(mark);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'access.refused',
      actor: h.ids.alice,
      subject_kind: 'artifact',
      subject: secret.id,
      space: h.quality,
      detail: {
        permission: 'read',
        target: `artifact:${secret.id}`,
        reason: 'not_granted',
        hidden: true,
        code: 'not_found',
      },
      labels: { subject: 'Quality plan' },
    });
  });

  it('IAM-013 records a grant answered as absent as a hidden refusal of the grant', async () => {
    const grant = await h.allow(h.ids.grace!, h.roles.Reader!, { kind: 'space', id: h.quality });
    const mark = await newest();
    const refused = await h.call(ALICE, 'DELETE', `/v1/grants/${grant}`);
    expect(refused.statusCode).toBe(404);
    const absent = await h.call(ALICE, 'DELETE', '/v1/grants/11111111-1111-4111-8111-111111111111');
    expect(absent.statusCode).toBe(404);
    const events = await eventsAfter(mark);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      subject_kind: 'grant',
      subject: grant,
      detail: { permission: expect.any(String), target: `grant:${grant}`, hidden: true },
    });
  });

  it('IAM-013 records a refusal by token, its scopes masking, and a token at a route that takes a session', async () => {
    const issued = await h.call('ada', 'POST', '/v1/tokens', {
      name: 'Reads only',
      scopes: [],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(issued.statusCode, issued.body).toBe(200);
    const { id: token, secret } = issued.json<{ id: string; secret: string }>();
    const mark = await newest();
    const masked = await h.bearer(secret, 'POST', `/v1/spaces/${h.general}/components`, {
      title: 'Masked',
      language: 'en-GB',
      direction: 'ltr',
    });
    expect(masked.statusCode, masked.body).toBe(403);
    const sessionOnly = await h.bearer(secret, 'GET', '/v1/tokens');
    expect(sessionOnly.statusCode, sessionOnly.body).toBe(403);
    const events = await eventsAfter(mark);
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'access.refused',
        actor_kind: 'token',
        actor: h.ids.ada,
        token,
        subject: h.general,
        detail: expect.objectContaining({ permission: 'create', reason: 'scoped', hidden: false }),
      }),
      expect.objectContaining({
        kind: 'access.refused',
        actor_kind: 'token',
        actor: h.ids.ada,
        token,
        subject_kind: null,
        detail: {
          permission: null,
          target: null,
          reason: 'token_not_allowed',
          level: null,
          hidden: false,
          code: 'token_not_allowed',
        },
      }),
    ]);
  });

  it("IAM-013 records a raw-body route's refusal", async () => {
    const onQuality = await h.allow(h.ids.grace!, h.roles.Author!, {
      kind: 'space',
      id: h.quality,
    });
    const made = await h.call('grace', 'POST', `/v1/spaces/${h.quality}/asset-uploads`, {
      alternative: null,
    });
    expect(made.statusCode, made.body).toBe(200);
    const upload = made.json<{ id: string }>().id;
    await h.tenantDb.withTenant(h.tenant, (trx) => removeGrant(trx, onQuality));
    const mark = await newest();
    const filled = await h.app.inject({
      method: 'PUT',
      url: `/v1/asset-uploads/${upload}/bytes`,
      headers: { host: HOST, cookie: h.cookies.grace!, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('not yet looked at'),
    });
    // Grace still reads Quality, as everybody does, and no longer creates in it.
    expect(filled.statusCode, filled.body).toBe(403);
    expect(await eventsAfter(mark)).toEqual([
      expect.objectContaining({
        kind: 'access.refused',
        actor: h.ids.grace,
        subject_kind: 'space',
        subject: h.quality,
        detail: expect.objectContaining({ permission: 'create', hidden: false, code: 'forbidden' }),
      }),
    ]);
  });

  it("IAM-013 records a check's swallowed per-binding refusal in the check's own transaction", async () => {
    const definition = await h.definition(connection.id);
    const component = await h.component(h.general, 'Readings');
    await h.place(
      component,
      binding('b1', definition.id, { parameters: { site: { literal: '7' } } }),
    );
    const document = await h.documentReferencing([component.id]);
    const node = document.nodes[0]!;
    h.connector.mode = 'answer';
    h.connector.run = ranOk([['7', 'Kept']]);
    const resolved = await h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/resolve`, {
      bindings: [{ node, binding: 'b1' }],
    });
    expect(resolved.statusCode, resolved.body).toBe(200);
    const mark = await newest();
    const checked = await h.call(ALICE, 'POST', `/v1/documents/${document.id}/bindings/check`, {});
    expect(checked.statusCode, checked.body).toBe(200);
    expect(checked.json()).toEqual({
      results: [{ node, binding: 'b1', outcome: 'unchecked', reason: 'permission' }],
    });
    expect(await eventsAfter(mark)).toEqual([
      expect.objectContaining({
        kind: 'access.refused',
        actor: h.ids.alice,
        subject_kind: 'artifact',
        subject: connection.id,
        space: h.general,
        detail: {
          permission: 'use_connection',
          target: `artifact:${connection.id}`,
          reason: 'not_granted',
          level: null,
          hidden: false,
          code: 'forbidden',
        },
        labels: expect.objectContaining({ subject: 'Readings' }),
      }),
    ]);
  });
});
