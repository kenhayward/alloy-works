import { createApiClient } from '@alloy-works/api-client';
import { DEFAULT_VALUE_FORMATS } from '@alloy-works/domain';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { bindingStatesIn } from './bindingContexts.js';
import { RevisionDialog } from './RevisionDialog.js';

const DOCUMENT = '99999999-9999-4999-8999-999999999999';
const NODE = 'n'.repeat(26);
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const provenance = {
  parameters: {},
  ran: { sql: null },
  identity: { kind: 'service' },
  at: '2026-10-05T09:00:00.000Z',
  rowCount: 2,
  checksum: '0'.repeat(64),
  columns: [
    { name: 'id', type: { base: 'integer' } },
    { name: 'name', type: { base: 'text' } },
  ],
};
const stateOf = (binding: Record<string, unknown>, taken: unknown) =>
  bindingStatesIn({
    bindings: [
      {
        node: NODE,
        binding: {
          type: 'binding',
          id: 'v1',
          query: '44444444-4444-4444-8444-444444444441',
          parameters: {},
          mode: 'checked',
          ...binding,
        },
        held: {
          resolution: '12',
          dataset: '55555555-5555-4555-8555-555555555555',
          version: '66666666-6666-4666-8666-666666666666',
          number: '0.1',
          provenance,
          key: ['id'],
          name: null,
          stale: false,
          taken,
          act: 'resolve',
          keepable: false,
          by: { id: 'p', displayName: 'Ada' },
          at: '2026-10-05T09:00:00.000Z',
        },
        waiting: null,
        definition: null,
        connection: null,
        definitionChanged: false,
        sincePublished: null,
        mayCheck: true,
        mayResolve: true,
        revisions: [],
      },
    ],
  })![0]!;

function opened(
  state: ReturnType<typeof stateOf>,
  columns: { name: string; type: { base: 'text' } }[] = [],
  status = 200,
) {
  const sent: unknown[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    sent.push(JSON.parse(await request.text()));
    return json(status, status === 200 ? {} : { code: 'revision_row_missing', message: 'No.' });
  }) as unknown as typeof fetch;
  const onDone = vi.fn();
  render(
    <RevisionDialog
      client={createApiClient({ baseUrl: 'http://revise.test', fetch: fetching })}
      document={DOCUMENT}
      revising={{ node: NODE, state, act: 'revise', columns }}
      formats={DEFAULT_VALUE_FORMATS}
      onClose={() => undefined}
      onDone={onDone}
    />,
  );
  return { sent, onDone };
}

describe('revising a value by hand (the RV plan, RV-I, RV-J)', () => {
  it('DAT-057 revises a value in place with a reason, showing it as the document will, and sends it in front of the result held', async () => {
    const { sent, onDone } = opened(
      stateOf(
        { take: { column: 'name' } },
        { value: 'Atlas', column: { name: 'name', type: { base: 'text' } } },
      ),
    );
    await userEvent.type(screen.getByLabelText('Value'), 'Atlas Quay');
    expect(screen.getByText('Shown as Atlas Quay')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Why'), 'The site was renamed.');
    await userEvent.click(screen.getByRole('button', { name: 'Revise' }));
    expect(sent).toEqual([
      {
        node: NODE,
        binding: 'v1',
        act: 'revise',
        value: 'Atlas Quay',
        reason: 'The site was renamed.',
        resolution: '12',
        replaces: null,
      },
    ]);
    expect(onDone).toHaveBeenCalledWith('Revised by hand.');
  });

  it("DAT-063 revises a bound table's cell by its row's key and its column, and says a row the result lacks", async () => {
    const { sent, onDone } = opened(
      stateOf({}, { table: true }),
      [{ name: 'name', type: { base: 'text' } }],
      409,
    );
    await userEvent.type(screen.getByLabelText('Row: id'), '36');
    await userEvent.type(screen.getByLabelText('Value'), 'Dunes');
    await userEvent.type(screen.getByLabelText('Why'), 'Surveyed.');
    await userEvent.click(screen.getByRole('button', { name: 'Revise' }));
    expect(sent).toEqual([
      expect.objectContaining({ cell: { key: { id: '36' }, column: 'name' }, value: 'Dunes' }),
    ]);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The result has no row with that key.',
    );
    expect(onDone).not.toHaveBeenCalled();
  });
});
