import { queryAs } from '@alloy-works/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { binding, ranOk, startHarness, type Harness } from './test/bindings-harness.js';

type Json = Record<string, unknown>;

interface Revision {
  id: string;
  cell: { key: Json; column: string } | null;
  value: string | boolean;
  reason: string;
  by: { id: string; displayName: string | null };
  stands: boolean;
  rowMissing?: boolean;
}
interface State {
  binding: Json & { id: string };
  held: { resolution: string; version: string; taken: Json | null } | null;
  waiting: { version: string } | null;
  revisions: Revision[];
}

/**
 * A value revised by hand through the service (bindings.md, "A value revised by hand"; the RV plan,
 * RV-C and RV-D): revised and withdrawn in front of the resolution held, and decided by every act that
 * records one.
 */
describe('values revised by hand through the service', () => {
  let h: Harness;
  let connection: { id: string; version: string };

  beforeAll(async () => {
    h = await startHarness();
    connection = await h.connection('Readings');
  });

  afterAll(async () => {
    await h?.close();
  });

  const placed = async (...inlines: unknown[]) => {
    const component = await h.component(h.general, 'Readings');
    await h.place(component, { type: 'text', value: 'The site is ', marks: [] }, ...inlines);
    const document = await h.documentReferencing([component.id]);
    return { component, document, node: document.nodes[0]! };
  };
  const placedBlocks = async (...blocks: unknown[]) => {
    const component = await h.component(h.general, 'Readings');
    await h.placeBlocks(component, ...blocks);
    const document = await h.documentReferencing([component.id]);
    return { component, document, node: document.nodes[0]! };
  };
  const stateOf = async (document: string, id: string, as = 'ada') => {
    const answer = await h.call(as, 'GET', `/v1/documents/${document}/bindings`);
    expect(answer.statusCode, answer.body).toBe(200);
    return answer.json<{ bindings: State[] }>().bindings.find((each) => each.binding.id === id)!;
  };
  const resolve = (document: string, bindings: Json[]) =>
    h.call('ada', 'POST', `/v1/documents/${document}/bindings/resolve`, { bindings });
  const revise = (document: string, body: Json, as = 'ada') =>
    h.call(as, 'POST', `/v1/documents/${document}/bindings/revisions`, body);
  const rowsOf = async (table: string) =>
    (await queryAs(h.db.adminUrl, `select * from ${h.tenant.schema}.${table} order by 1`))
      .rows as Json[];
  const events = async (kind: string) =>
    (
      await queryAs(
        h.db.adminUrl,
        `select detail from ${h.tenant.schema}.audit_event where kind = $1 order by sequence`,
        [kind],
      )
    ).rows.map((row) => row.detail as Json);

  /** A document holding one value, resolved: Atlas, site 31. */
  const resolvedValue = async (site: string) => {
    const definition = await h.definition(connection.id);
    const made = await placed(
      binding('v1', definition.id, { parameters: { site: { literal: site } } }),
    );
    h.connector.run = ranOk([[site, 'Atlas']]);
    expect((await resolve(made.document.id, [{ node: made.node, binding: 'v1' }])).statusCode).toBe(
      200,
    );
    return { ...made, state: await stateOf(made.document.id, 'v1') };
  };

  it('DAT-057 DAT-058 revises a value in place, in front of what the query returned, which is kept; withdrawn, the query value shows again', async () => {
    const { document, node, state } = await resolvedValue('31');
    const resolution = state.held!.resolution;
    let answer = await revise(document.id, {
      node,
      binding: 'v1',
      act: 'revise',
      value: 'Atlas Quay',
      reason: 'The site was renamed.',
      resolution,
      replaces: null,
    });
    expect(answer.statusCode, answer.body).toBe(200);
    const revised = answer.json<State>();
    // The query's value is held still; the revision stands in front of it.
    expect(revised.held).toMatchObject({ resolution, taken: { value: 'Atlas' } });
    expect(revised.revisions).toEqual([
      expect.objectContaining({
        cell: null,
        value: 'Atlas Quay',
        reason: 'The site was renamed.',
        by: { id: h.ids.ada, displayName: expect.any(String) },
        stands: true,
      }),
    ]);
    expect(
      (await rowsOf('binding_resolution')).filter((row) => row.document_id === document.id),
    ).toHaveLength(1);
    // Audited with what it was and what it became.
    expect((await events('binding.revised')).at(-1)).toMatchObject({
      document: document.id,
      node,
      binding: 'v1',
      act: 'revise',
      resolution,
      was: 'Atlas',
      became: 'Atlas Quay',
    });

    // A second revision replaces the first, naming it; one naming nothing is refused.
    const first = revised.revisions[0]!.id;
    answer = await revise(document.id, {
      node,
      binding: 'v1',
      act: 'revise',
      value: 'Atlas Wharf',
      reason: 'Renamed again.',
      resolution,
      replaces: null,
    });
    expect(answer.statusCode).toBe(409);
    expect(answer.json()).toMatchObject({ code: 'revision_precondition' });
    answer = await revise(document.id, {
      node,
      binding: 'v1',
      act: 'withdraw',
      value: null,
      reason: 'Back to the source.',
      resolution,
      replaces: first,
    });
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json<State>().revisions).toEqual([]);
    expect((await events('binding.revised')).at(-1)).toMatchObject({
      act: 'withdraw',
      was: 'Atlas Quay',
      became: null,
    });
    // Nothing stands to withdraw now.
    answer = await revise(document.id, {
      node,
      binding: 'v1',
      act: 'withdraw',
      value: null,
      reason: 'Again.',
      resolution,
      replaces: null,
    });
    expect(answer.json()).toMatchObject({ code: 'revision_not_standing' });
  });

  it("refuses a value not of its column's type, a blank one, and a reader who may not edit the document, recording nothing", async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(
      binding('v2', definition.id, {
        parameters: { site: { literal: '32' } },
        take: { column: 'id' },
      }),
    );
    h.connector.run = ranOk([['32', 'Basin']]);
    await resolve(document.id, [{ node, binding: 'v2' }]);
    const resolution = (await stateOf(document.id, 'v2')).held!.resolution;
    const body = (value: string) => ({
      node,
      binding: 'v2',
      act: 'revise',
      value,
      reason: 'Corrected.',
      resolution,
      replaces: null,
    });
    expect((await revise(document.id, body('thirty'))).json()).toMatchObject({
      code: 'value_invalid',
    });
    expect((await revise(document.id, body('   '))).json()).toMatchObject({ code: 'value_empty' });
    expect((await revise(document.id, body('33'), 'alice')).statusCode).toBe(403);
    expect(
      (await rowsOf('binding_revision')).filter((row) => row.document_id === document.id),
    ).toEqual([]);
    expect((await revise(document.id, body('33'))).statusCode).toBe(200);
  });

  it('DAT-060 refuses an accept over a revision unless it says withdraw or keep over exactly what stands, and keeps or withdraws it in front of the new result', async () => {
    const { document, node, state } = await resolvedValue('34');
    // Grace revises; Ada accepts. The value kept stays Grace's, entered when she entered it (H1).
    const revised = await revise(
      document.id,
      {
        node,
        binding: 'v1',
        act: 'revise',
        value: 'Atlas Quay',
        reason: 'The site was renamed.',
        resolution: state.held!.resolution,
        replaces: null,
      },
      'grace',
    );
    const revision = revised.json<State>().revisions[0]!.id;
    const enteredAt = revised.json<{ revisions: { at: string }[] }>().revisions[0]!.at;
    h.connector.run = ranOk([['34', 'Atlas North']]);
    await h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/check`, {});
    const waiting = (await stateOf(document.id, 'v1')).waiting!.version;
    const accept = (revisions?: Json) =>
      h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/accept`, {
        node,
        binding: 'v1',
        version: waiting,
        replaces: state.held!.version,
        ...(revisions === undefined ? {} : { revisions }),
      });

    let answer = await accept();
    expect(answer.statusCode).toBe(409);
    expect(answer.json()).toMatchObject({
      code: 'revision_decision_required',
      rule: 'DAT-060',
      revisions: [revision],
    });
    answer = await accept({ decision: 'keep', over: [] });
    expect(answer.json()).toMatchObject({ code: 'revision_precondition' });
    expect((await stateOf(document.id, 'v1')).held!.version).toBe(state.held!.version);

    answer = await accept({ decision: 'keep', over: [revision] });
    expect(answer.statusCode, answer.body).toBe(200);
    const kept = answer.json<State>();
    // The new result held, its own value the source's, and the person's value kept in front of it.
    expect(kept.held).toMatchObject({ version: waiting, taken: { value: 'Atlas North' } });
    expect(kept.revisions).toEqual([
      expect.objectContaining({
        value: 'Atlas Quay',
        reason: 'The site was renamed.',
        stands: true,
        by: expect.objectContaining({ id: h.ids.grace }),
        at: enteredAt,
      }),
    ]);
    expect(kept.revisions[0]!.id).not.toBe(revision);
    expect((await events('binding.revised')).at(-1)).toMatchObject({ act: 'keep' });

    // Resolved again, it must decide too; withdrawn, nothing stands.
    h.connector.run = ranOk([['34', 'Atlas South']]);
    answer = await resolve(document.id, [{ node, binding: 'v1' }]);
    expect(answer.json()).toMatchObject({ code: 'revision_decision_required' });
    answer = await resolve(document.id, [
      { node, binding: 'v1', revisions: { decision: 'withdraw', over: [kept.revisions[0]!.id] } },
    ]);
    expect(answer.statusCode, answer.body).toBe(200);
    const after = await stateOf(document.id, 'v1');
    expect(after.held!.taken).toMatchObject({ value: 'Atlas South' });
    expect(after.revisions).toEqual([]);
  });

  it("DAT-057 DAT-063 revises a bound table's cell by its row's key, refuses its key column and a row the result lacks, and says a kept cell's row gone", async () => {
    const definition = await h.definition(connection.id);
    const whole = binding('t', definition.id, { parameters: { site: { literal: '35' } } });
    delete (whole as Json).take;
    const { document, node } = await placedBlocks({
      type: 'boundTable',
      id: 't1',
      binding: whole,
      caption: [{ type: 'text', value: 'Sites', marks: [] }],
      columns: [
        { column: 'id', header: 'Site' },
        { column: 'name', header: 'Name' },
      ],
      headerColumn: true,
    });
    h.connector.run = ranOk([
      ['35', 'Cove'],
      ['36', 'Dune'],
    ]);
    await resolve(document.id, [{ node, binding: 't' }]);
    const state = await stateOf(document.id, 't');
    const cellBody = (cell: Json, value: string) => ({
      node,
      binding: 't',
      cell,
      act: 'revise',
      value,
      reason: 'Corrected by the survey.',
      resolution: state.held!.resolution,
      replaces: null,
    });
    expect(
      (await revise(document.id, cellBody({ key: { id: '35' }, column: 'id' }, '37'))).json(),
    ).toMatchObject({ code: 'revision_not_possible' });
    expect(
      (await revise(document.id, cellBody({ key: { id: '99' }, column: 'name' }, 'Gone'))).json(),
    ).toMatchObject({ code: 'revision_row_missing' });
    expect(
      (await revise(document.id, cellBody({ key: { site: '35' }, column: 'name' }, 'X'))).json(),
    ).toMatchObject({ code: 'key_required' });
    const answer = await revise(
      document.id,
      cellBody({ key: { id: '36' }, column: 'name' }, 'Dunes'),
    );
    // A second naming the same row by another spelling of its key is the same cell (H2): it must
    // name the first as what it replaces.
    expect(
      (
        await revise(document.id, cellBody({ key: { id: '036' }, column: 'name' }, 'Dune Ridge'))
      ).json(),
    ).toMatchObject({ code: 'revision_precondition' });
    expect(answer.statusCode, answer.body).toBe(200);
    const [revision] = answer.json<State>().revisions;
    expect(revision).toMatchObject({
      cell: { key: { id: '36' }, column: 'name' },
      value: 'Dunes',
      stands: true,
      rowMissing: false,
    });

    // The page's rows carry it in its cell, named as revised.
    const rows = await h.call(
      'ada',
      'GET',
      `/v1/documents/${document.id}/bindings/${node}/t/rows?version=${state.held!.version}`,
    );
    expect(rows.statusCode, rows.body).toBe(200);
    expect(rows.json()).toMatchObject({
      result: {
        rows: [
          ['35', 'Cove'],
          ['36', 'Dunes'],
        ],
      },
      revised: [{ row: 1, column: 'name' }],
    });

    // The source drops the row; kept, the revision stands with its row said gone.
    h.connector.run = ranOk([['35', 'Cove']]);
    const resolved = await resolve(document.id, [
      { node, binding: 't', revisions: { decision: 'keep', over: [revision!.id] } },
    ]);
    expect(resolved.statusCode, resolved.body).toBe(200);
    expect((await stateOf(document.id, 't')).revisions).toEqual([
      expect.objectContaining({ value: 'Dunes', stands: true, rowMissing: true }),
    ]);
  });

  it('lists a revision as lapsed once the binding holds a result it does not stand in front of', async () => {
    const { document, node, state } = await resolvedValue('38');
    await revise(document.id, {
      node,
      binding: 'v1',
      act: 'revise',
      value: 'Atlas Quay',
      reason: 'Renamed.',
      resolution: state.held!.resolution,
      replaces: null,
    });
    // Recorded straight after, as an act deciding nothing would: the revision stands for nothing.
    await queryAs(
      h.db.adminUrl,
      `insert into ${h.tenant.schema}.binding_resolution
         (document_id, node_id, binding_id, binding_digest, dataset_version, dataset_id, replaces, act, resolved_by)
       select document_id, node_id, binding_id, binding_digest, dataset_version, dataset_id,
              dataset_version, 'confirm', resolved_by
         from ${h.tenant.schema}.binding_resolution where id = $1`,
      [state.held!.resolution],
    );
    expect((await stateOf(document.id, 'v1')).revisions).toEqual([
      expect.objectContaining({ value: 'Atlas Quay', stands: false }),
    ]);
  });
});
