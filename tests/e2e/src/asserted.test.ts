import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SERVICE, signIn, untilReady } from './session.js';
import { askTheSource, atTheSource, holdingAtTheSource } from './source.js';

/**
 * Asserted identity over the whole system (the D7 plan, D7.3): a connection to the development source
 * as its `asserter`, running as each person by the email they signed in with, where the seed made Ada
 * and Grace a role each and `sample.reading` shows each only their own site's rows (deploy/sources/
 * postgres.sql). The second test makes a table of its own, so locking it holds nobody else's run.
 */
const ASSERTER = { account: 'asserter', password: 'source-asserter-dev-password' };

type Json = Record<string, unknown>;

/** Readings by site: how many, of the rows the person resolving it may see. */
const bySite = (table: string) => ({
  sources: [{ alias: 'r', table: { schema: 'sample', name: table } }],
  joins: [],
  select: [
    { name: 'site', of: { source: 'r', column: 'site' } },
    { name: 'readings', of: { aggregate: 'count' } },
  ],
  groupBy: [{ source: 'r', column: 'site' }],
});

describe('asserted identity over the whole system', () => {
  const cookies: Record<string, string> = {};
  let general = '';
  let connection = '';
  const held = `d7_held_${Date.now()}`;

  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const response = await fetch(`${SERVICE}${path}`, {
      method,
      headers: {
        cookie: cookies[as]!,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: (text === '' ? {} : JSON.parse(text)) as Json };
  };
  const ok = (answer: { status: number; body: Json }) => {
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    return answer.body;
  };

  /** A component placing one binding of a definition by site, in a document of its own; Grace's. */
  const placed = async (table: string) => {
    const definition = ok(
      await call('ada', 'POST', `/v1/spaces/${general}/query-definitions`, {
        definition: {
          schemaVersion: 1,
          title: `Readings as each person ${randomUUID()}`,
          description: 'How many readings each site has, as the person asking sees them.',
          connection,
          parameters: [],
          fetch: { kind: 'builder', format: 1, query: bySite(table) },
          columns: [
            { name: 'site', from: { column: 'site' }, type: { base: 'integer' } },
            { name: 'readings', from: { column: 'readings' }, type: { base: 'integer' } },
          ],
          key: ['site'],
          order: [{ column: 'site', direction: 'ascending' }],
          empty: 'valid',
          limits: { rows: 100, bytes: 65_536, seconds: 60 },
          retired: false,
        },
      }),
    )['id'] as string;
    const component = ok(
      await call('grace', 'POST', `/v1/spaces/${general}/components`, {
        title: 'Readings as each person',
        language: 'en-GB',
        direction: 'ltr',
      }),
    ) as { id: string; version: { id: string } };
    const session = randomUUID();
    ok(await call('grace', 'POST', `/v1/components/${component.id}/lock`, { session }));
    ok(
      await call('grace', 'PUT', `/v1/components/${component.id}/iterations/${session}/1`, {
        openedFrom: component.version.id,
        content: {
          schemaVersion: 1,
          title: 'Readings as each person',
          language: 'en-GB',
          direction: 'ltr',
          content: [
            {
              type: 'paragraph',
              id: 'p1',
              style: 'body',
              content: [
                { type: 'text', value: 'Readings: ', marks: [] },
                {
                  type: 'binding',
                  id: 'count',
                  query: definition,
                  parameters: {},
                  mode: 'checked',
                  take: { column: 'readings' },
                },
              ],
            },
          ],
        },
      }),
    );
    ok(
      await call(
        'grace',
        'DELETE',
        `/v1/components/${component.id}/lock?session=${session}&openedFrom=${component.version.id}`,
      ),
    );
    const document = ok(
      await call('grace', 'POST', `/v1/spaces/${general}/documents`, {
        title: `Readings as each person ${Date.now()}`,
        language: 'en-GB',
        direction: 'ltr',
      }),
    ) as { id: string; version: { id: string } };
    const outlined = ok(
      await call('grace', 'POST', `/v1/documents/${document.id}/outline`, {
        openedFrom: document.version.id,
        operation: {
          operation: 'insert',
          parent: null,
          position: 0,
          node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
        },
      }),
    ) as { outline: { nodes: { id: string }[] } };
    return { document: document.id, node: outlined.outline.nodes[0]!.id };
  };

  /** What the binding holds now, as Ada reads the document: the dataset version, or null. */
  const holding = async (document: string) => {
    const view = ok(await call('ada', 'GET', `/v1/documents/${document}/bindings`)) as {
      bindings: { held: { version: string } | null }[];
    };
    return view.bindings[0]!.held?.version ?? null;
  };

  beforeAll(async () => {
    await untilReady();
    cookies.ada = await signIn('ada');
    cookies.grace = await signIn('grace');
    const spaces = await call('ada', 'GET', '/v1/spaces');
    general = (spaces.body['items'] as { id: string; name: string }[]).find(
      (space) => space.name === 'General',
    )!.id;
    connection = ok(
      await call('ada', 'POST', `/v1/spaces/${general}/connections`, {
        settings: {
          schemaVersion: 1,
          name: `Readings as each person ${Date.now()}`,
          description: 'The development source, as each person.',
          type: 'postgres',
          source: {
            host: 'source-postgres',
            port: 5432,
            database: 'readings',
            account: ASSERTER.account,
            tls: 'require',
          },
          identity: { kind: 'endUser', mechanism: 'asserted', attribute: 'email' },
          retired: false,
        },
      }),
    )['id'] as string;
    // Tested as the account, which reads nothing of its own: no finding.
    expect(
      ok(
        await call('ada', 'PUT', `/v1/connections/${connection}/credential`, {
          secret: ASSERTER.password,
        }),
      ),
    ).toMatchObject({ test: { outcome: 'ok', findings: [] } });
    atTheSource(`
      create table sample.${held} (id integer primary key, site integer not null);
      insert into sample.${held} values (1, 1), (2, 2);
      grant select on sample.${held} to "ada@example.com", "grace@example.com";
    `);
  }, 180_000);

  afterAll(() => {
    atTheSource(`drop table if exists sample.${held};`);
  });

  it('resolves one question for Ada and for Grace as each of them, each holding the rows the source shows them, over the whole system', async () => {
    const { document, node } = await placed('reading');
    const resolve = async (as: string, sharesOwnView?: true) =>
      call(as, 'POST', `/v1/documents/${document}/bindings/resolve`, {
        bindings: [{ node, binding: 'count' }],
        ...(sharesOwnView ? { sharesOwnView } : {}),
      });

    // Her own view is held only once she says everybody who may read the document may see it.
    const unacknowledged = await resolve('ada');
    expect(unacknowledged.status).toBe(409);
    expect(unacknowledged.body).toMatchObject({ code: 'acknowledgement_required' });

    const seen = async (as: string) => {
      const answer = ok(await resolve(as, true)) as { results: { held: { version: string } }[] };
      return ok(
        await call(
          as,
          'GET',
          `/v1/documents/${document}/datasets/${answer.results[0]!.held.version}`,
        ),
      ) as { result: { rows: unknown[] }; provenance: Json };
    };
    const ada = await seen('ada');
    const grace = await seen('grace');
    // The North weir's two readings for Ada, the South bank's one for Grace: the source's own policy.
    expect(ada.result.rows).toEqual([['1', '2']]);
    expect(grace.result.rows).toEqual([['2', '1']]);
    expect(ada.provenance['identity']).toMatchObject({
      kind: 'endUser',
      mechanism: 'asserted',
      signInRoute: 'organisation',
      asSeen: 'ada@example.com',
    });
    expect(grace.provenance['identity']).toMatchObject({ asSeen: 'grace@example.com' });
  }, 180_000);

  it('IAM-082 stops a run held at the source within two seconds of its person signing out, and of their token being revoked, over the whole system: the source loses the query, nothing is recorded, the answer names why and the live updates close', async () => {
    const { document, node } = await placed(held);
    const before = await holding(document);
    const waiting = () =>
      askTheSource(
        `select count(*) from pg_stat_activity
           where usename = 'asserter' and wait_event_type = 'Lock';`,
      )[0];

    /**
     * A resolve sent with `credential`, held at the source by a lock on the table it reads, then
     * `end`ed: answered `authority_ended` for `reason`, the source's query - and for a session the live
     * updates it opened, which a token may not open - gone within two seconds, and nothing recorded.
     */
    const stopped = async (
      credential: Record<string, string>,
      end: () => Promise<number>,
      reason: 'signed_out' | 'token_revoked',
    ) => {
      let updates: ReadableStreamDefaultReader<Uint8Array> | undefined;
      if (reason === 'signed_out') {
        const stream = await fetch(`${SERVICE}/v1/stream`, { headers: credential });
        expect(stream.status).toBe(200);
        updates = stream.body!.getReader();
        await updates.read();
      }
      const hold = holdingAtTheSource(
        `${held}_lock`,
        `begin; lock table sample.${held} in access exclusive mode; select pg_sleep(60); commit;`,
      );
      try {
        await until(
          () =>
            askTheSource(
              `select count(*) from pg_locks l join pg_stat_activity a on a.pid = l.pid
                 where a.application_name = '${held}_lock' and l.mode = 'AccessExclusiveLock'
                   and l.granted;`,
            )[0] === '1',
        );
        const asked = fetch(`${SERVICE}/v1/documents/${document}/bindings/resolve`, {
          method: 'POST',
          headers: { ...credential, 'content-type': 'application/json' },
          body: JSON.stringify({ bindings: [{ node, binding: 'count' }], sharesOwnView: true }),
        });
        // Waiting on the lock at the source, as the person.
        await until(() => waiting() === '1');

        expect(await end()).toBe(204);
        const at = Date.now();
        const closed = (async () => {
          for (;;) {
            const { done } = updates === undefined ? { done: true } : await updates.read();
            if (done) return Date.now();
          }
        })();
        const answer = await asked;
        const answeredAt = Date.now();
        expect(answer.status, reason).toBe(401);
        expect(await answer.json()).toMatchObject({ code: 'authority_ended', reason });
        expect(answeredAt - at, reason).toBeLessThan(2000);
        expect((await closed) - at, reason).toBeLessThan(2000);
        // The source no longer runs it, though the lock it waited on is still held.
        await until(() => waiting() === '0', 2000 - (Date.now() - at));
        expect(await holding(document)).toBe(before);
      } finally {
        hold.release();
      }
    };

    // Grace signs out.
    await stopped(
      { cookie: cookies.grace! },
      async () => (await call('grace', 'POST', '/v1/sign-out')).status,
      'signed_out',
    );

    // Ada revokes the token she was asking with.
    const issued = ok(
      await call('ada', 'POST', '/v1/tokens', {
        name: `Stopped ${Date.now()}`,
        scopes: ['edit', 'use_connection'],
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ) as { id: string; secret: string };
    await stopped(
      { authorization: `Bearer ${issued.secret}` },
      async () => (await call('ada', 'DELETE', `/v1/tokens/${issued.id}`)).status,
      'token_revoked',
    );
  }, 180_000);
});

/** Waits for `met`, asking every 100 ms, or throws after `within` ms. */
async function until(met: () => boolean, within = 30_000): Promise<void> {
  const stop = Date.now() + Math.max(within, 0);
  for (;;) {
    if (met()) return;
    if (Date.now() > stop) throw new Error('never met');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
