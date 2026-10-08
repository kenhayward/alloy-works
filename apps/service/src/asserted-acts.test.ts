import { pendingResult, refusePending, uploadForDatasetImage } from '@alloy-works/db';
import { queryAs } from '@alloy-works/db/testing';
import type { Provenance } from '@alloy-works/domain';
import { tenantPrefix } from '@alloy-works/objects';
import type { RunAnswer } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  binding,
  definitionBody,
  ranOk,
  sha256,
  startHarness,
  type Cell,
  type Harness,
} from './test/bindings-harness.js';

type Json = Record<string, unknown>;

/** A site's name by its id, built rather than written: the one fetch a person's identity runs (DAT-113). */
const builtFetch = {
  kind: 'builder',
  format: 1,
  query: {
    sources: [{ alias: 's', table: { schema: 'sample', name: 'site' } }],
    joins: [],
    select: [
      { name: 'id', of: { source: 's', column: 'id' } },
      { name: 'name', of: { source: 's', column: 'name' } },
    ],
    where: { column: { source: 's', column: 'id' }, is: 'equal', to: { parameter: 'site' } },
    groupBy: [],
  },
};

/** The draft a sample runs: the definition less its title, description and retired. */
const draftOf = (connection: string, over: Json = {}) => {
  const whole: Json = definitionBody(connection, over);
  delete whole.title;
  delete whole.description;
  delete whole.retired;
  return whole;
};

const assertedBy = (attribute: 'email' | 'subject') => ({
  identity: { kind: 'endUser' as const, mechanism: 'asserted' as const, attribute },
});

interface RunAsked {
  readonly identity?: { kind: string; role?: string };
}

describe('acts on a connection that runs as each person', () => {
  let h: Harness;
  let own: { id: string; version: string };
  let built: { id: string; version: string };

  beforeAll(async () => {
    h = await startHarness({ events: true });
    own = await h.connection('Own readings', h.general, assertedBy('email'));
    built = await h.definition(own.id, { title: 'My site', fetch: builtFetch });
  });

  afterAll(async () => {
    await h?.close();
  });

  /** The rows a person's run answers, the source having seen the role it was asked as. */
  const answersAs = (rows: Cell[][]) => {
    h.connector.mode = 'answer';
    h.connector.runFor = (body) => ({
      ...(ranOk(rows) as Extract<RunAnswer, { outcome: 'ok' }>),
      asSeen: (body as RunAsked).identity?.role ?? 'reader',
    });
  };

  const placed = async (...inlines: unknown[]) => {
    const component = await h.component(h.general, 'Readings');
    await h.place(component, { type: 'text', value: 'The site is ', marks: [] }, ...inlines);
    const document = await h.documentReferencing([component.id]);
    return { document, node: document.nodes[0]! };
  };
  const resolve = (as: string, document: string, node: string, more: Json = {}) =>
    h.call(as, 'POST', `/v1/documents/${document}/bindings/resolve`, {
      bindings: [{ node, binding: 'b1' }],
      ...more,
    });
  const check = (as: string, document: string) =>
    h.call(as, 'POST', `/v1/documents/${document}/bindings/check`, {});
  const stateOf = async (as: string, document: string) => {
    const answer = await h.call(as, 'GET', `/v1/documents/${document}/bindings`);
    expect(answer.statusCode, answer.body).toBe(200);
    return answer.json<{
      bindings: {
        held: { version: string; provenance: Json } | null;
        waiting: { version: string } | null;
        mayCheck: boolean;
      }[];
    }>().bindings[0]!;
  };
  const runs = () => h.connector.asked.filter((each) => each.path === '/v1/run');
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
  });

  it('DAT-024 DAT-117 runs as the caller, by the role their email names, and records whose view it is and as whom the source saw them', async () => {
    const { document, node } = await placed(binding('b1', built.id));
    answersAs([['1', 'North']]);
    const before = runs().length;
    const answer = await resolve('ada', document.id, node, { sharesOwnView: true });
    expect(answer.statusCode, answer.body).toBe(200);
    expect(
      runs()
        .slice(before)
        .map((each) => (each.body as RunAsked).identity),
    ).toEqual([{ kind: 'asserted', role: 'ada@example.com' }]);
    expect((await stateOf('ada', document.id)).held?.provenance).toMatchObject({
      identity: {
        kind: 'endUser',
        mechanism: 'asserted',
        principal: h.ids.ada,
        signInRoute: 'organisation',
        asSeen: 'ada@example.com',
      },
    });
    // Grace's view of the same question is a dataset of her own: one identity, one dataset.
    const graces = await resolve('grace', document.id, node, { sharesOwnView: true });
    expect(graces.statusCode, graces.body).toBe(200);
    const [adas, hers] = [answer, graces].map(
      (each) => each.json<{ results: { held: { dataset: string } }[] }>().results[0]!.held.dataset,
    );
    expect(hers).not.toBe(adas);
    const keys = (
      await queryAs(
        h.db.adminUrl,
        `select identity_key from ${h.tenant.schema}.dataset where artifact_id in ($1, $2) order by identity_key`,
        [adas, hers],
      )
    ).rows.map((row) => (row as { identity_key: string }).identity_key);
    expect(keys.sort()).toEqual([`asserted:${h.ids.ada}`, `asserted:${h.ids.grace}`].sort());
  });

  it('runs as the subject where the connection names people by it, and as the creator of a token, saying so', async () => {
    const bySubject = await h.connection('By subject', h.general, assertedBy('subject'));
    const definition = await h.definition(bySubject.id, { title: 'By subject', fetch: builtFetch });
    const { document, node } = await placed(binding('b1', definition.id));
    answersAs([['1', 'North']]);
    const issued = await h.call('ada', 'POST', '/v1/tokens', {
      name: 'Readings',
      scopes: ['edit', 'use_connection'],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(issued.statusCode, issued.body).toBe(200);
    const before = runs().length;
    const answer = await h.bearer(
      issued.json<{ secret: string }>().secret,
      'POST',
      `/v1/documents/${document.id}/bindings/resolve`,
      { bindings: [{ node, binding: 'b1' }], sharesOwnView: true },
    );
    expect(answer.statusCode, answer.body).toBe(200);
    // The stand-in provider's subject for Ada is her user id there.
    expect(
      runs()
        .slice(before)
        .map((each) => (each.body as RunAsked).identity),
    ).toEqual([{ kind: 'asserted', role: 'ada' }]);
    expect((await stateOf('ada', document.id)).held?.provenance).toMatchObject({
      identity: { principal: h.ids.ada, signInRoute: 'token', asSeen: 'ada' },
    });
  });

  it('DAT-117 refuses an act whose caller the connection cannot name identity_unavailable, before anything runs', async () => {
    const { document, node } = await placed(binding('b1', built.id));
    answersAs([['1', 'North']]);
    const set = (email: string | null) =>
      queryAs(h.db.adminUrl, `update ${h.tenant.schema}.principal set email = $1 where id = $2`, [
        email,
        h.ids.grace,
      ]);
    try {
      for (const email of [null, `${'g'.repeat(52)}@example.com`]) {
        await set(email);
        const before = h.connector.asked.length;
        const answer = await resolve('grace', document.id, node, { sharesOwnView: true });
        expect(answer.statusCode, answer.body).toBe(409);
        expect(answer.json()).toMatchObject({
          code: 'identity_unavailable',
          attribution: 'product',
          binding: 'b1',
        });
        const sampled = await h.call('grace', 'POST', `/v1/connections/${own.id}/sample`, {
          definition: draftOf(own.id, { fetch: builtFetch }),
          values: { site: '1' },
        });
        expect(sampled.json()).toMatchObject({ code: 'identity_unavailable' });
        const described = await h.call('grace', 'POST', `/v1/connections/${own.id}/describe`, {});
        expect(described.statusCode, described.body).toBe(409);
        expect(described.json()).toMatchObject({ code: 'identity_unavailable' });
        expect(h.connector.asked.length).toBe(before);
      }
    } finally {
      await set('grace@example.com');
    }
  });

  it("never asserts an email its provider did not verify, nor a subject of another provider than the environment's own", async () => {
    const { document, node } = await placed(binding('b1', built.id));
    const bySubject = await h.connection('By subject, again', h.general, assertedBy('subject'));
    const definition = await h.definition(bySubject.id, { title: 'By subject', fetch: builtFetch });
    const subjects = await placed(binding('b1', definition.id));
    answersAs([['1', 'North']]);
    const principal = (set: string, value: unknown) =>
      queryAs(h.db.adminUrl, `update ${h.tenant.schema}.principal set ${set} = $1 where id = $2`, [
        value,
        h.ids.grace,
      ]);
    const refused = async (document: string, node: string) => {
      const before = h.connector.asked.length;
      const answer = await resolve('grace', document, node, { sharesOwnView: true });
      expect(answer.statusCode, answer.body).toBe(409);
      expect(answer.json()).toMatchObject({ code: 'identity_unavailable' });
      expect(h.connector.asked.length).toBe(before);
    };
    // An email the provider did not verify names nobody: anybody could claim it.
    await principal('email_verified', false);
    try {
      await refused(document.id, node);
    } finally {
      await principal('email_verified', true);
    }
    // A subject means a person only at the environment's own provider: Google's could be anybody's.
    const issuer = (
      await queryAs(
        h.db.adminUrl,
        `select issuer from ${h.tenant.schema}.principal where id = $1`,
        [h.ids.grace],
      )
    ).rows[0] as { issuer: string };
    await principal('issuer', 'https://accounts.google.com');
    try {
      await refused(subjects.document.id, subjects.node);
    } finally {
      await principal('issuer', issuer.issuer);
    }
    expect(
      (await resolve('grace', subjects.document.id, subjects.node, { sharesOwnView: true }))
        .statusCode,
    ).toBe(200);
  });

  it('describes and samples as the caller, and tests as the account', async () => {
    h.connector.mode = 'answer';
    answersAs([['1', 'North']]);
    const before = h.connector.asked.length;
    const described = await h.call('grace', 'POST', `/v1/connections/${own.id}/describe`, {});
    expect(described.statusCode, described.body).toBe(200);
    const sampled = await h.call('grace', 'POST', `/v1/connections/${own.id}/sample`, {
      definition: draftOf(own.id, { fetch: builtFetch }),
      values: { site: '1' },
    });
    expect(sampled.statusCode, sampled.body).toBe(200);
    const tested = await h.call('ada', 'POST', `/v1/connections/${own.id}/test`, {});
    expect(tested.statusCode, tested.body).toBe(200);
    expect(
      h.connector.asked
        .slice(before)
        .map((each) => [each.path, (each.body as RunAsked).identity ?? null]),
    ).toEqual([
      ['/v1/describe', { kind: 'asserted', role: 'grace@example.com' }],
      ['/v1/run', { kind: 'asserted', role: 'grace@example.com' }],
      ['/v1/test', null],
    ]);
  });

  it("DAT-084 runs a checked binding holding a person's own view again for that person alone, and never flags it for anybody else", async () => {
    const { document, node } = await placed(binding('b1', built.id));
    answersAs([['1', 'North']]);
    expect((await resolve('ada', document.id, node, { sharesOwnView: true })).statusCode).toBe(200);
    // The source answers differently now; for Grace that is another view, never a source that moved.
    answersAs([['1', 'Moved']]);
    const before = runs().length;
    const graces = await check('grace', document.id);
    expect(graces.statusCode, graces.body).toBe(200);
    expect(graces.json()).toEqual({
      results: [{ node, binding: 'b1', outcome: 'unchecked', reason: 'identity' }],
    });
    expect(runs().length).toBe(before);
    expect((await stateOf('grace', document.id)).mayCheck).toBe(false);
    // For Ada it is her own view: run again as her, and the difference is flagged.
    expect((await stateOf('ada', document.id)).mayCheck).toBe(true);
    const adas = await check('ada', document.id);
    expect(adas.statusCode, adas.body).toBe(200);
    expect(adas.json()).toMatchObject({
      results: [{ node, binding: 'b1', outcome: 'revision' }],
    });
    expect(
      runs()
        .slice(before)
        .map((each) => (each.body as RunAsked).identity),
    ).toEqual([{ kind: 'asserted', role: 'ada@example.com' }]);
  });

  it("offers a waiting result that is a person's own view to them alone, and refuses anybody else's accepting it identity_differs", async () => {
    const { document, node } = await placed(binding('b1', built.id));
    answersAs([['1', 'North']]);
    await resolve('ada', document.id, node, { sharesOwnView: true });
    answersAs([['1', 'Moved']]);
    await check('ada', document.id);
    const adas = await stateOf('ada', document.id);
    expect(adas.waiting).not.toBeNull();
    const graces = await stateOf('grace', document.id);
    expect(graces.waiting).toBeNull();
    const read = (as: string) =>
      h.call(as, 'GET', `/v1/documents/${document.id}/datasets/${adas.waiting!.version}`);
    expect((await read('ada')).statusCode).toBe(200);
    expect((await read('grace')).statusCode).toBe(404);
    const before = await recorded();
    const accepted = await h.call('grace', 'POST', `/v1/documents/${document.id}/bindings/accept`, {
      node,
      binding: 'b1',
      version: adas.waiting!.version,
      replaces: adas.held!.version,
      sharesOwnView: true,
    });
    expect(accepted.statusCode, accepted.body).toBe(403);
    expect(accepted.json()).toMatchObject({ code: 'identity_differs', binding: 'b1' });
    expect(await recorded()).toEqual(before);
  });

  it("finishes a pending result that is a person's own view for them alone, identity_differs for anybody else", async () => {
    const { document, node } = await placed(binding('b1', built.id));
    answersAs([['1', 'North']]);
    await resolve('ada', document.id, node, { sharesOwnView: true });
    const provenance = (await stateOf('ada', document.id)).held!.provenance as Provenance;
    // A pending result of Ada's view that names Grace as the one following it: no route makes one,
    // so it is written here, and refused, as an image refused would leave it.
    const pending = await h.tenantDb.withTenant(h.tenant, async (trx) => {
      const { upload } = await uploadForDatasetImage(trx, {
        spaceId: h.general,
        uploader: h.ids.grace!,
        key: `${tenantPrefix(h.tenant)}sha256/${sha256('an image')}`,
        format: 'png',
        bytes: 1,
      });
      const made = await pendingResult(trx, {
        act: 'resolve',
        document: document.id,
        node,
        binding: 'b1',
        digest: sha256('a binding'),
        holding: null,
        session: null,
        provenance,
        uploads: [upload.id],
        by: h.ids.grace!,
      });
      await refusePending(trx, made.id, { code: 'image_refused', attribution: 'query' });
      return made.id;
    });
    const followed = await h.call('grace', 'GET', `/v1/datasets/pending/${pending}`);
    expect(followed.statusCode, followed.body).toBe(200);
    expect(followed.json()).toMatchObject({
      state: 'done',
      result: { binding: 'b1', failure: { code: 'identity_differs' } },
    });
  });

  it("DAT-091 holds one's own view only where the caller acknowledges that everybody who may read the document will see it, resolving or accepting", async () => {
    const { document, node } = await placed(binding('b1', built.id));
    answersAs([['1', 'North']]);
    const before = h.connector.asked.length;
    const unacknowledged = await resolve('ada', document.id, node);
    expect(unacknowledged.statusCode, unacknowledged.body).toBe(409);
    expect(unacknowledged.json()).toMatchObject({
      code: 'acknowledgement_required',
      rule: 'DAT-091',
      binding: 'b1',
    });
    expect(h.connector.asked.length).toBe(before);
    expect((await resolve('ada', document.id, node, { sharesOwnView: true })).statusCode).toBe(200);
    answersAs([['1', 'Moved']]);
    await check('ada', document.id);
    const state = await stateOf('ada', document.id);
    const accept = (more: Json) =>
      h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/accept`, {
        node,
        binding: 'b1',
        version: state.waiting!.version,
        replaces: state.held!.version,
        ...more,
      });
    const refusedAccept = await accept({});
    expect(refusedAccept.statusCode, refusedAccept.body).toBe(409);
    expect(refusedAccept.json()).toMatchObject({ code: 'acknowledgement_required' });
    expect((await stateOf('ada', document.id)).held!.version).toBe(state.held!.version);
    const acknowledged = await accept({ sharesOwnView: true });
    expect(acknowledged.statusCode, acknowledged.body).toBe(200);
    expect((await stateOf('ada', document.id)).held!.version).toBe(state.waiting!.version);
  });

  it('DAT-102 refuses SQL on a connection that runs as each person, saved, sampled, described or run, a definition saved before the connection changed among them', async () => {
    const sqlRefused = {
      code: 'sql_not_permitted',
      reason: 'asserted',
      rule: 'DAT-102',
      attribution: 'product',
    };
    // Saved.
    const saved = await h.call('ada', 'POST', `/v1/spaces/${h.general}/query-definitions`, {
      definition: definitionBody(own.id),
    });
    expect(saved.statusCode, saved.body).toBe(409);
    expect(saved.json()).toMatchObject(sqlRefused);
    // Sampled and described.
    const sampled = await h.call('ada', 'POST', `/v1/connections/${own.id}/sample`, {
      definition: draftOf(own.id),
      values: { site: '1' },
    });
    expect(sampled.statusCode, sampled.body).toBe(409);
    expect(sampled.json()).toMatchObject(sqlRefused);
    const described = await h.call('ada', 'POST', `/v1/connections/${own.id}/describe`, {
      sql: { text: 'select 1 as one', parameters: [] },
    });
    expect(described.statusCode, described.body).toBe(409);
    expect(described.json()).toMatchObject(sqlRefused);

    // Saved while its connection ran as the account, which then changes to run as each person: the
    // change is not refused, the definition is named where the connection is used, and it runs no more.
    const changing = await h.connection('Changing');
    const before = await h.definition(changing.id, { title: 'Written before' });
    const { document, node } = await placed(binding('b1', before.id));
    h.connector.mode = 'answer';
    h.connector.runFor = undefined;
    h.connector.run = ranOk([['1', 'North']]);
    expect((await resolve('ada', document.id, node)).statusCode).toBe(200);
    const changed = await h.call('ada', 'POST', `/v1/connections/${changing.id}/versions`, {
      openedFrom: changing.version,
      settings: {
        schemaVersion: 1,
        name: 'Changing',
        description: '',
        type: 'postgres',
        source: {
          host: 'source-postgres',
          port: 5432,
          database: 'readings',
          account: 'reader',
          tls: 'require',
        },
        ...assertedBy('email'),
        retired: false,
      },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    const uses = await h.call('ada', 'GET', `/v1/connections/${changing.id}/uses`);
    expect(uses.json()).toMatchObject({
      definitions: { readable: [{ id: before.id }] },
    });
    const runsBefore = runs().length;
    const ran = await resolve('ada', document.id, node, { sharesOwnView: true });
    expect(ran.statusCode, ran.body).toBe(409);
    expect(ran.json()).toMatchObject({ ...sqlRefused, binding: 'b1' });
    const checked = await check('ada', document.id);
    expect(checked.json()).toMatchObject({
      results: [{ binding: 'b1', outcome: 'failed', failure: { code: 'sql_not_permitted' } }],
    });
    expect(runs().length).toBe(runsBefore);
    const next = await h.call('ada', 'POST', `/v1/query-definitions/${before.id}/versions`, {
      openedFrom: before.version,
      definition: definitionBody(changing.id, { title: 'Written again' }),
    });
    expect(next.statusCode, next.body).toBe(409);
    expect(next.json()).toMatchObject(sqlRefused);
  });
});
