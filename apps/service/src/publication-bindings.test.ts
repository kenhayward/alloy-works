import { defaultNumberingScheme } from '@alloy-works/domain';
import { findRole, recordPublication } from '@alloy-works/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  binding,
  definitionBody,
  ranOk,
  startHarness,
  type Harness,
} from './test/bindings-harness.js';

/**
 * A publish of a document holding values, through the routes (the B3 plan, task 4): refused naming
 * each binding with no result, and otherwise recorded, its values' results read back to a reader of
 * the publication with the SQL, the connection and the source columns only to a definition's reader.
 */

type Json = Record<string, unknown>;

describe('publishing a document holding values, through the routes', () => {
  let h: Harness;
  let connection: { id: string; version: string };

  beforeAll(async () => {
    h = await startHarness();
    connection = await h.connection('Readings');
    // Ada publishes in General.
    const publisher = await h.tenantDb.withTenant(h.tenant, (trx) => findRole(trx, 'Publisher'));
    await h.allow(h.ids.ada!, publisher!.id, { kind: 'space', id: h.general });
  });

  afterAll(async () => {
    await h?.close();
  });

  const placed = async (...inlines: unknown[]) => {
    const component = await h.component(h.general, 'Readings');
    await h.place(component, { type: 'text', value: 'The site is ', marks: [] }, ...inlines);
    const document = await h.documentReferencing([component.id]);
    return { document, node: document.nodes[0]! };
  };
  const publish = (document: { id: string; version: string }, as = 'ada') =>
    h.call(as, 'POST', `/v1/documents/${document.id}/publications`, {
      version: document.version,
      formats: ['pdf'],
    });
  const preview = (document: { id: string; version: string }) =>
    h.call('ada', 'POST', `/v1/documents/${document.id}/previews`, { version: document.version });

  it('DAT-087 refuses a publish and a preview of a document holding a value never resolved, naming the binding, its node and the document, and takes one once it is resolved', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(binding('b1', definition.id));
    for (const answer of [await publish(document), await preview(document)]) {
      expect(answer.statusCode, answer.body).toBe(400);
      expect({ ...answer.json<Json>(), traceId: undefined }).toEqual({
        code: 'binding_unresolved',
        message:
          'This document holds a value with no result to print: b1 (never resolved). Resolve it in this document first.',
        attribution: 'product',
        document: document.id,
        bindings: [{ node, binding: 'b1', reason: 'never' }],
        traceId: undefined,
      });
    }
    h.connector.run = ranOk([['1', 'Lighthouse']]);
    const resolved = await h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/resolve`, {
      bindings: [{ node, binding: 'b1' }],
    });
    expect(resolved.statusCode, resolved.body).toBe(200);
    expect((await publish(document)).statusCode).toBe(200);
  });

  it('DAT-042 answers what each value of a publication was taken from to its readers, the SQL, connection and source columns only to a reader of the definition, and lists provenance.json among its outputs', async () => {
    // A definition in Quality, which Ada reads and Alice, a reader of General, does not.
    await h.allow(h.ids.ada!, h.roles.Author!, { kind: 'space', id: h.quality });
    const quality = await h.definition(connection.id, { title: 'Sites in Quality' }, h.quality);
    const { document, node } = await placed(binding('b1', quality.id));
    h.connector.run = ranOk([['1', 'Lighthouse']]);
    const resolved = await h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/resolve`, {
      bindings: [{ node, binding: 'b1' }],
    });
    expect(resolved.statusCode, resolved.body).toBe(200);
    const asked = await publish(document);
    expect(asked.statusCode, asked.body).toBe(200);
    // Recorded as the worker records it.
    const publication = await h.tenantDb.withTenant(h.tenant, (trx) =>
      recordPublication(trx, {
        requestId: asked.json<{ id: string }>().id,
        pipelineVersion: '16',
        fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
        dataSha256: 'b'.repeat(64),
        numbering: { scheme: defaultNumberingScheme.id, entries: [] },
        outputs: [
          {
            format: 'pdf',
            engineVersion: '0.15.1',
            templateVersion: 15,
            key: `${h.tenant.role}/sha256/${'c'.repeat(64)}`,
            sha256: 'c'.repeat(64),
            bytes: 1000,
          },
          {
            format: 'provenance',
            pipelineVersion: '16',
            key: `${h.tenant.role}/sha256/${'e'.repeat(64)}`,
            sha256: 'e'.repeat(64),
            bytes: 200,
          },
        ],
      }),
    );

    const read = await h.call('alice', 'GET', `/v1/publications/${publication}`);
    expect(read.statusCode, read.body).toBe(200);
    expect(
      read.json<{ outputs: Json[] }>().outputs.map((each) => [each.format, each.producer]),
    ).toEqual([
      ['pdf', 'typst'],
      ['provenance', 'pipeline'],
    ]);

    const bindingsOf = async (as: string) => {
      const answer = await h.call(as, 'GET', `/v1/publications/${publication}/bindings`);
      expect(answer.statusCode, answer.body).toBe(200);
      return answer.json<{ bindings: (Json & { result: Json })[] }>().bindings;
    };
    const ada = await bindingsOf('ada');
    expect(ada).toMatchObject([
      {
        node,
        binding: 'b1',
        dataset: { number: '0.1' },
        result: {
          rowCount: 1,
          ran: { sql: 'select id, name from sample.site where id = $1::int8 order by id' },
          connection: { artifact: connection.id },
          columns: [
            { name: 'id', from: { column: 'id' } },
            { name: 'name', from: { column: 'name' } },
          ],
        },
      },
    ]);
    // Alice reads the publication and not the definition: the same record, less what is its alone.
    const alice = await bindingsOf('alice');
    expect(alice).toHaveLength(1);
    expect(alice[0]!.result.ran).toBeUndefined();
    expect(alice[0]!.result.connection).toBeUndefined();
    expect(alice[0]!.result.columns).toEqual([
      { name: 'id', type: { base: 'integer' } },
      { name: 'name', type: { base: 'text' } },
    ]);
    expect({ ...alice[0]!, result: { ...alice[0]!.result, columns: [] } }).toEqual({
      ...ada[0]!,
      result: { ...ada[0]!.result, columns: [], ran: undefined, connection: undefined },
    });
    // And an id that is no publication Alice may read is answered as none.
    const outsider = await h.call('alice', 'GET', `/v1/publications/${quality.id}/bindings`);
    expect(outsider.statusCode).toBe(404);
  });

  it('DAT-070 flags a floating binding once its definition advances and never a pinned one, and shows how each binding has changed since the document was last published', async () => {
    const definition = await h.definition(connection.id);
    const component = await h.component(h.general, 'Readings');
    const floating = binding('b1', definition.id, { parameters: { site: { literal: '71' } } });
    const pinned = binding('b2', definition.id, {
      version: definition.version,
      parameters: { site: { literal: '72' } },
    });
    await h.place(component, floating, pinned);
    const document = await h.documentReferencing([component.id]);
    const node = document.nodes[0]!;
    h.connector.run = ranOk([['71', 'One']]);
    await h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/resolve`, {
      bindings: [
        { node, binding: 'b1' },
        { node, binding: 'b2' },
      ],
    });
    type Facts = {
      binding: { id: string };
      held: { version: string } | null;
      waiting: { version: string } | null;
      definitionChanged: boolean;
      sincePublished: null | 'new' | string[];
      mayCheck: boolean;
      mayResolve: boolean;
    };
    const facts = async (as = 'ada') => {
      const answer = await h.call(as, 'GET', `/v1/documents/${document.id}/bindings`);
      expect(answer.statusCode, answer.body).toBe(200);
      return Object.fromEntries(
        answer.json<{ bindings: Facts[] }>().bindings.map((each) => [each.binding.id, each]),
      );
    };
    const accept = async (id: string) => {
      const now = (await facts())[id]!;
      const answer = await h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/accept`, {
        node,
        binding: id,
        version: now.waiting!.version,
        replaces: now.held!.version,
      });
      expect(answer.statusCode, answer.body).toBe(200);
    };
    // Never published: nothing has changed since.
    let now = await facts();
    expect([now.b1!.sincePublished, now.b2!.sincePublished]).toEqual([null, null]);
    expect([now.b1!.definitionChanged, now.b2!.definitionChanged]).toEqual([false, false]);
    // Ada may check and resolve; Alice reads the document, and may do neither.
    expect([now.b1!.mayCheck, now.b1!.mayResolve]).toEqual([true, true]);
    const alice = await facts('alice');
    expect([alice.b1!.mayCheck, alice.b1!.mayResolve]).toEqual([false, false]);

    const asked = await publish(document);
    expect(asked.statusCode, asked.body).toBe(200);
    await h.tenantDb.withTenant(h.tenant, (trx) =>
      recordPublication(trx, {
        requestId: asked.json<{ id: string }>().id,
        pipelineVersion: '16',
        fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
        dataSha256: 'b'.repeat(64),
        numbering: { scheme: defaultNumberingScheme.id, entries: [] },
        outputs: [
          {
            format: 'pdf',
            engineVersion: '0.15.1',
            templateVersion: 15,
            key: `${h.tenant.role}/sha256/${'c'.repeat(64)}`,
            sha256: 'c'.repeat(64),
            bytes: 1000,
          },
          {
            format: 'provenance',
            pipelineVersion: '16',
            key: `${h.tenant.role}/sha256/${'e'.repeat(64)}`,
            sha256: 'e'.repeat(64),
            bytes: 200,
          },
        ],
      }),
    );
    now = await facts();
    expect([now.b1!.sincePublished, now.b2!.sincePublished]).toEqual([null, null]);

    // The definition advances: the floating binding is flagged, the pinned one is not.
    await h.nextDefinition(
      definition.id,
      definition.version,
      definitionBody(connection.id, { description: 'Advanced.' }),
    );
    now = await facts();
    expect([now.b1!.definitionChanged, now.b2!.definitionChanged]).toEqual([true, false]);
    expect(now.b1!.sincePublished).toBeNull();

    // Accepting the new definition's result: another dataset version and definition version.
    h.connector.run = ranOk([['71', 'Two']]);
    await h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/check`, {});
    await accept('b1');
    await accept('b2');
    now = await facts();
    expect(now.b1!.definitionChanged).toBe(false);
    expect(now.b1!.sincePublished).toEqual(['dataset', 'definition']);
    expect(now.b2!.sincePublished).toEqual(['dataset']);

    // The pinned binding takes another column, and a binding is added.
    await h.place(
      component,
      floating,
      { ...pinned, take: { column: 'id' } },
      binding('b3', definition.id),
    );
    now = await facts();
    expect(now.b2!.sincePublished).toEqual(['digest', 'dataset']);
    expect(now.b3!.sincePublished).toBe('new');
  });
});
