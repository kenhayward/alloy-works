import { queryAs } from '@alloy-works/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { binding, ranOk, startHarness, type Harness } from './test/bindings-harness.js';

type Json = Record<string, unknown>;

/**
 * Signing out, or revoking a token, stops what that credential was doing at the source within two
 * seconds, on every replica (the D7 plan, D7-I): the connector's request is closed - which the
 * connector answers by killing its child, `server.test.ts` shows - and the act answers
 * `authority_ended` with its reason, recording nothing.
 */
describe('an act stops when the authority it runs by ends', () => {
  let h: Harness;
  let connection: { id: string; version: string };
  let definition: { id: string; version: string };
  let release = () => {};

  beforeAll(async () => {
    h = await startHarness({ events: true });
    connection = await h.connection('Readings');
    definition = await h.definition(connection.id);
  });

  afterEach(() => {
    release();
    h.connector.held = undefined;
  });

  afterAll(async () => {
    await h?.close();
  });

  /** Every request but a seal held at the source until released, or closed by its caller. */
  const holdAtTheSource = () => {
    h.connector.mode = 'answer';
    h.connector.runFor = undefined;
    h.connector.run = ranOk([['1', 'North']]);
    h.connector.held = new Promise<void>((resolve) => {
      release = resolve;
    });
  };
  /** Waits until a request reaches the source after `from` of them had. */
  const reaching = async (from: number) => {
    const started = Date.now();
    while (h.connector.reached.length <= from) {
      if (Date.now() - started > 10_000) throw new Error('Nothing reached the source');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const placed = async () => {
    const component = await h.component(h.general, 'Readings');
    await h.place(
      component,
      { type: 'text', value: 'The site is ', marks: [] },
      binding('b1', definition.id),
    );
    const document = await h.documentReferencing([component.id]);
    return { document, node: document.nodes[0]! };
  };
  const count = async (sql: string) =>
    (
      (await queryAs(h.db.adminUrl, sql.replaceAll('$schema', h.tenant.schema))).rows[0] as {
        n: number;
      }
    ).n;
  const recorded = async () => ({
    versions: await count(
      `select count(*)::int as n from $schema.artifact_version where kind = 'dataset'`,
    ),
    resolutions: await count(`select count(*)::int as n from $schema.binding_resolution`),
    tests: await count(`select count(*)::int as n from $schema.connection_test`),
  });
  const stoppedLines = () =>
    h.lines
      .map((line) => JSON.parse(line) as Json)
      .filter((line) => line.msg === 'an act was stopped: the authority it ran by ended');

  it('stops a resolve held at the source within two seconds of its session signing out on another replica', async () => {
    const { document, node } = await placed();
    const ada = await h.session('ada');
    const other = h.replica();
    holdAtTheSource();
    const before = await recorded();
    const reached = h.connector.reached.length;
    const asked = other(ada, 'POST', `/v1/documents/${document.id}/bindings/resolve`, {
      bindings: [{ node, binding: 'b1' }],
    });
    await reaching(reached);
    const signedOut = await h.call(ada, 'POST', '/v1/sign-out');
    expect(signedOut.statusCode).toBe(204);
    const at = Date.now();
    const answer = await asked;
    expect(answer.statusCode, answer.body).toBe(401);
    expect(answer.json()).toMatchObject({
      code: 'authority_ended',
      reason: 'signed_out',
    });
    const closed = h.connector.closed.at(-1)!;
    expect(closed.path).toBe('/v1/run');
    expect(closed.at - at).toBeLessThan(2000);
    expect(await recorded()).toEqual(before);
    expect(stoppedLines().at(-1)).toMatchObject({ reason: 'signed_out' });
  });

  it('stops a sample on a replica that missed the notice, by reading its session again each second', async () => {
    const ada = await h.session('ada');
    const deaf = h.replica({ events: false });
    holdAtTheSource();
    const reached = h.connector.reached.length;
    const draft: Json = {
      schemaVersion: 1,
      connection: connection.id,
      parameters: [{ name: 'site', type: { base: 'integer' }, required: true, list: false }],
      fetch: {
        kind: 'sql',
        text: 'select id, name from sample.site where id = {{site}} order by id',
      },
      columns: [
        { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
        { name: 'name', from: { column: 'name' }, type: { base: 'text' } },
      ],
      key: ['id'],
      order: [{ column: 'id', direction: 'ascending' }],
      empty: 'valid',
      limits: { rows: 1000, bytes: 1_048_576, seconds: 30 },
    };
    const asked = deaf(ada, 'POST', `/v1/connections/${connection.id}/sample`, {
      definition: draft,
      values: { site: '1' },
    });
    await reaching(reached);
    expect((await h.call(ada, 'POST', '/v1/sign-out')).statusCode).toBe(204);
    const at = Date.now();
    const answer = await asked;
    expect(answer.statusCode, answer.body).toBe(401);
    expect(answer.json()).toMatchObject({ code: 'authority_ended', reason: 'signed_out' });
    expect(h.connector.closed.at(-1)!.at - at).toBeLessThan(2000);
  });

  it('stops a check and a test held at the source within two seconds of their token being revoked on another replica', async () => {
    const { document, node } = await placed();
    h.connector.held = undefined;
    h.connector.mode = 'answer';
    h.connector.run = ranOk([['1', 'North']]);
    expect(
      (
        await h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/resolve`, {
          bindings: [{ node, binding: 'b1' }],
        })
      ).statusCode,
    ).toBe(200);
    for (const act of ['check', 'test'] as const) {
      const issued = await h.call('ada', 'POST', '/v1/tokens', {
        name: `Stopped ${act}`,
        scopes: ['edit', 'use_connection'],
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      expect(issued.statusCode, issued.body).toBe(200);
      const { id, secret } = issued.json<{ id: string; secret: string }>();
      holdAtTheSource();
      const before = await recorded();
      const reached = h.connector.reached.length;
      const asked =
        act === 'check'
          ? h.bearer(secret, 'POST', `/v1/documents/${document.id}/bindings/check`, {})
          : h.bearer(secret, 'POST', `/v1/connections/${connection.id}/test`, {});
      await reaching(reached);
      const revoked = await h.replica()('ada', 'DELETE', `/v1/tokens/${id}`);
      expect(revoked.statusCode).toBe(204);
      const at = Date.now();
      const answer = await asked;
      expect(answer.statusCode, `${act}: ${answer.body}`).toBe(401);
      expect(answer.json()).toMatchObject({ code: 'authority_ended', reason: 'token_revoked' });
      expect(h.connector.closed.at(-1)!.at - at, act).toBeLessThan(2000);
      expect(await recorded(), act).toEqual(before);
      expect(stoppedLines().at(-1)).toMatchObject({ reason: 'token_revoked' });
      release();
    }
  });
});
