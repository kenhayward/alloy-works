import { auditEvents, newestEvent, queryAs, type ReadEvent } from '@alloy-works/db/testing';
import { findRole } from '@alloy-works/db';
import { dataFailures } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  binding,
  HOST,
  ranOk,
  SECRET,
  settings,
  startHarness,
  type Harness,
} from './test/bindings-harness.js';

/**
 * Content and data on the audit log, through the service (the AU1 plan, task 4; AU1-K and AU1-L):
 * each act's events in its own transactions - those after a commit included - as the person whose
 * act it is, never the system.
 */
describe('content and data on the audit log, through the service', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });

  afterAll(async () => {
    await h?.close();
  });

  /** The events `act` recorded, in sequence order. */
  async function recorded(act: () => Promise<unknown>): Promise<ReadEvent[]> {
    const before = await h.tenantDb.withTenant(h.tenant, newestEvent);
    await act();
    return h.tenantDb.withTenant(h.tenant, (trx) => auditEvents(trx, before));
  }

  const ok = async (answer: Promise<{ statusCode: number; body: string }>, status = 200) => {
    const answered = await answer;
    expect(answered.statusCode, answered.body).toBe(status);
    return answered as unknown as { json<T>(): T };
  };

  /** Each event is Ada's, by her session, under the request's trace id. */
  const asAda = (events: readonly ReadEvent[]) => {
    for (const event of events) {
      expect(event, event.kind).toMatchObject({ actorKind: 'person', actor: h.ids.ada });
      expect(event.traceId, event.kind).toEqual(expect.any(String));
      expect(event.labels.actor?.refersTo, event.kind).toBe(h.ids.ada);
    }
  };

  it("DAT-007 records a connection's acts through its routes as the person who did them, the test after the commit included", async () => {
    h.connector.mode = 'answer';
    h.connector.test = { outcome: 'ok', findings: [] };
    let made: { id: string; version: { id: string } } | undefined;
    const making = await recorded(async () => {
      made = (
        await ok(
          h.call('ada', 'POST', `/v1/spaces/${h.general}/connections`, {
            settings: settings({ name: 'Audited readings' }),
          }),
        )
      ).json();
    });
    const id = made!.id;
    expect(making.map((event) => event.kind)).toEqual(['content.version_cut', 'connection.made']);

    // The credential set, and tested straight after its commit, in a transaction of its own.
    const setting = await recorded(() =>
      ok(h.call('ada', 'PUT', `/v1/connections/${id}/credential`, { secret: SECRET })),
    );
    expect(setting.map((event) => event.kind)).toEqual([
      'connection.credential_set',
      'connection.tested',
    ]);
    expect(setting[1]!.detail).toEqual({ outcome: 'ok', findings: [] });

    const changing = await recorded(() =>
      ok(
        h.call('ada', 'POST', `/v1/connections/${id}/versions`, {
          openedFrom: made!.version.id,
          settings: settings({ name: 'Audited readings', description: 'Now described.' }),
        }),
      ),
    );
    expect(changing.map((event) => [event.kind, event.detail])).toEqual([
      ['content.version_cut', { kind: 'connection', parent: made!.version.id }],
      ['connection.changed', { settings: ['description'] }],
    ]);

    h.connector.test = {
      outcome: 'failed',
      failure: { code: 'connection_failed', attribution: dataFailures.connection_failed },
    };
    const testing = await recorded(() =>
      ok(h.call('ada', 'POST', `/v1/connections/${id}/test`, {})),
    );
    expect(testing.map((event) => [event.kind, event.detail])).toEqual([
      ['connection.tested', { outcome: 'failed', findings: [], failure: 'connection_failed' }],
    ]);
    h.connector.test = { outcome: 'ok', findings: [] };

    const retiring = await recorded(() =>
      ok(
        h.call('ada', 'POST', `/v1/connections/${id}/versions`, {
          openedFrom: changing[0]!.subjectVersion,
          settings: settings({
            name: 'Audited readings',
            description: 'Now described.',
            retired: true,
          }),
        }),
      ),
    );
    expect(retiring.map((event) => event.kind)).toEqual([
      'content.version_cut',
      'connection.retired',
    ]);

    const all = [...making, ...setting, ...changing, ...testing, ...retiring];
    asAda(all);
    for (const event of all) {
      expect(event, event.kind).toMatchObject({ subject: id, space: h.general });
      expect(event.subjectVersion, event.kind).toEqual(expect.any(String));
      expect(event.labels.subject?.text, event.kind).toBe('Audited readings');
    }
    expect(JSON.stringify(all)).not.toContain(SECRET);
  });

  it('records a binding resolved, checked, accepted and kept, each as the person who did it', async () => {
    const connection = await h.connection('Bound readings');
    const definition = await h.definition(connection.id);
    const component = await h.component(h.general, 'Sites');
    const placeTaking = (column: string) =>
      h.place(
        component,
        { type: 'text', value: 'The site is ', marks: [] },
        binding('b1', definition.id, { take: { column } }),
      );
    await placeTaking('name');
    const document = await h.documentReferencing([component.id]);
    const node = document.nodes[0]!;
    const state = async () =>
      (await ok(h.call('ada', 'GET', `/v1/documents/${document.id}/bindings`))).json<{
        bindings: {
          held: { dataset: string; version: string };
          waiting: { version: string } | null;
        }[];
      }>().bindings[0]!;
    const naming = { document: document.id, node, binding: 'b1' };

    h.connector.mode = 'answer';
    h.connector.run = ranOk([['1', 'North']]);
    const resolving = await recorded(() =>
      ok(
        h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/resolve`, {
          bindings: [{ node, binding: 'b1' }],
        }),
      ),
    );
    const first = (await state()).held;
    expect(resolving.map((event) => event.kind)).toEqual([
      'content.version_cut',
      'binding.resolved',
    ]);
    expect(resolving[0]).toMatchObject({ subjectKind: 'dataset', subjectVersion: first.version });
    expect(resolving[1]).toMatchObject({
      subjectKind: 'document',
      subject: document.id,
      subjectVersion: document.version,
      space: h.general,
      detail: { ...naming, dataset: first.dataset, version: first.version },
    });
    expect(resolving[1]!.labels.subject?.text).toEqual(expect.any(String));

    h.connector.run = ranOk([['1', 'North Quay']]);
    const checking = await recorded(() =>
      ok(h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/check`, {})),
    );
    const waiting = (await state()).waiting!;
    expect(checking.map((event) => [event.kind, event.detail])).toEqual([
      ['content.version_cut', { kind: 'dataset', parent: first.version }],
      [
        'binding.checked',
        { ...naming, dataset: first.dataset, version: waiting.version, outcome: 'revision' },
      ],
    ]);

    const accepting = await recorded(() =>
      ok(
        h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/accept`, {
          node,
          binding: 'b1',
          version: waiting.version,
          replaces: first.version,
        }),
      ),
    );
    expect(accepting.map((event) => [event.kind, event.detail])).toEqual([
      ['binding.accepted', { ...naming, dataset: first.dataset, version: waiting.version }],
    ]);

    // Taking another column asks the same question: what it holds is kept.
    await placeTaking('id');
    const keeping = await recorded(() =>
      ok(
        h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/confirm`, {
          node,
          binding: 'b1',
          replaces: waiting.version,
        }),
      ),
    );
    expect(keeping.map((event) => [event.kind, event.detail])).toEqual([
      ['binding.confirmed', { ...naming, dataset: first.dataset, version: waiting.version }],
    ]);
    asAda([...resolving, ...checking, ...accepting, ...keeping]);
  });

  it('records a publication requested as its requester, and a preview not at all', async () => {
    const publisher = await h.tenantDb.withTenant(h.tenant, (trx) => findRole(trx, 'Publisher'));
    await h.allow(h.ids.ada!, publisher!.id, { kind: 'space', id: h.general });
    const component = await h.component(h.general, 'Published');
    const document = await h.documentReferencing([component.id]);
    const requesting = await recorded(() =>
      ok(
        h.call('ada', 'POST', `/v1/documents/${document.id}/publications`, {
          version: document.version,
          formats: ['pdf'],
        }),
      ),
    );
    expect(requesting).toHaveLength(1);
    expect(requesting[0]).toMatchObject({
      kind: 'publication.requested',
      subjectKind: 'document',
      subject: document.id,
      subjectVersion: document.version,
      space: h.general,
      detail: { formats: ['pdf'] },
    });
    asAda(requesting);
    const previewing = await recorded(() =>
      ok(
        h.call('ada', 'POST', `/v1/documents/${document.id}/previews`, {
          version: document.version,
        }),
      ),
    );
    expect(previewing).toEqual([]);
  });

  it('AST-037 records an upload refused at the door as its uploader, never referenceable and keeping none of its bytes', async () => {
    const upload = (
      await ok(
        h.call('ada', 'POST', `/v1/spaces/${h.general}/asset-uploads`, { alternative: null }),
      )
    ).json<{ id: string }>().id;
    const refusing = await recorded(async () => {
      const answer = await h.app.inject({
        method: 'PUT',
        url: `/v1/asset-uploads/${upload}/bytes`,
        headers: {
          host: HOST,
          cookie: h.cookies.ada!,
          'content-type': 'application/octet-stream',
        },
        payload: Buffer.from('This is not an image at all.'),
      });
      expect(answer.statusCode).toBeGreaterThanOrEqual(400);
    });
    expect(refusing).toHaveLength(1);
    expect(refusing[0]).toMatchObject({
      kind: 'asset.refused',
      outcome: 'refused',
      subjectKind: 'asset_upload',
      subject: upload,
      space: h.general,
    });
    expect(refusing[0]!.detail.reason).toMatch(/^[a-z_]+$/);
    asAda(refusing);
    // Nothing of the file is kept: the upload names no object (AST-037).
    const row = (
      await queryAs(
        h.db.adminUrl,
        `select state, object_key, asset_version_id from ${h.tenant.schema}.asset_upload where id = $1`,
        [upload],
      )
    ).rows[0];
    expect(row).toEqual({ state: 'refused', object_key: null, asset_version_id: null });
  });
});
