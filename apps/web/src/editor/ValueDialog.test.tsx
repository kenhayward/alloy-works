import { createApiClient } from '@alloy-works/api-client';
import type { Binding } from '@alloy-works/domain';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PARAMETER_WORDS, RUNS_AS, ValueDialog } from './ValueDialog.js';

const SITES = '44444444-4444-4444-8444-444444444441';
const VISITS = '44444444-4444-4444-8444-444444444442';
const RETIRED = '44444444-4444-4444-8444-444444444443';
const LATEST = '55555555-5555-4555-8555-555555555551';
const COMPONENT = '88888888-8888-4888-8888-888888888888';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const summary = (id: string, title: string, identity: string, retired = false) => ({
  id,
  title,
  space: { id: '11111111-1111-4111-8111-111111111111', name: 'General' },
  connection: { id: '33333333-3333-4333-8333-333333333333', name: null, identity },
  retired,
  version: { id: LATEST, number: '0.3' },
  changedAt: '2026-10-05T09:00:00.000Z',
});

const view = (mayUse = true) => ({
  id: SITES,
  space: { id: '11111111-1111-4111-8111-111111111111', name: 'General' },
  version: { id: LATEST, number: '0.3', author: null, createdAt: '', note: null },
  definition: {
    title: 'Site by id',
    parameters: [{ name: 'site', type: { base: 'integer' }, required: true, list: false }],
    columns: [
      { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
      { name: 'name', from: { column: 'name' }, type: { base: 'text' } },
    ],
    key: ['id'],
  },
  connection: { id: '33333333-3333-4333-8333-333333333333', name: null, identity: 'service' },
  mayEdit: false,
  mayRun: false,
  mayUse,
});

function dialog(
  over: Partial<React.ComponentProps<typeof ValueDialog>> = {},
  answers: { mayUse?: boolean; holders?: unknown } = {},
) {
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    if (path === '/v1/query-definitions') {
      return json(200, {
        items: [
          summary(SITES, 'Site by id', 'service'),
          summary(VISITS, 'Visits by person', 'endUser'),
          summary(RETIRED, 'Old sites', 'service', true),
        ],
        next: null,
        total: 3,
        facets: { spaces: [] },
      });
    }
    if (path === `/v1/query-definitions/${SITES}`) return json(200, view(answers.mayUse));
    if (path.endsWith('/holders')) {
      return json(200, answers.holders ?? { documents: { readable: [], others: 0 } });
    }
    return json(404, { code: 'not_found', message: 'No.' });
  }) as unknown as typeof fetch;
  const onDone = vi.fn(() => null);
  const onCancel = vi.fn();
  render(
    <ValueDialog
      client={createApiClient({ baseUrl: 'http://value.test', fetch: fetching })}
      componentId={COMPONENT}
      current={null}
      inDocument={{ pinned: false }}
      onDone={onDone}
      onCancel={onCancel}
      {...over}
    />,
  );
  return { onDone, onCancel };
}

const bound: Binding = {
  type: 'binding',
  id: 'b1',
  query: SITES,
  parameters: { site: { literal: '1' } },
  mode: 'checked',
  take: { column: 'name' },
};

describe('the Value dialog (the B2 plan, task 4)', () => {
  it('DAT-022 the Value dialog says whose identity each definition runs as, beside it and on the one chosen', async () => {
    dialog();
    expect(await screen.findByRole('heading', { name: 'Value' })).toBeInTheDocument();
    const sites = await screen.findByRole('radio', { name: /Site by id/ });
    expect(sites.closest('label')).toHaveTextContent(
      'Site by id - General - Runs as the service account',
    );
    expect(
      screen.getByRole('radio', { name: /Visits by person/ }).closest('label'),
    ).toHaveTextContent("Runs as each reader's own view, as the source sees them");
    expect(screen.queryByRole('radio', { name: /Old sites/ })).toBeNull();
    await userEvent.click(sites);
    expect(await screen.findByText('Runs as the service account.')).toBeInTheDocument();
  });

  it('places a binding by keyboard alone, saying beside a parameter why its value does not fit', async () => {
    const user = userEvent.setup();
    const { onDone } = dialog();
    await screen.findByRole('radio', { name: /Site by id/ });
    expect(screen.getByLabelText('Find a query definition by title')).toHaveFocus();
    await user.keyboard('Site');
    expect(screen.queryByRole('radio', { name: /Visits/ })).toBeNull();
    await user.tab();
    expect(screen.getByRole('radio', { name: /Site by id/ })).toHaveFocus();
    await user.keyboard(' ');
    const site = await screen.findByLabelText('site');
    site.focus();
    await user.keyboard('north');
    expect(await screen.findByText('site is not of its type.')).toBeInTheDocument();
    await user.clear(site);
    await user.keyboard('7{Enter}');
    expect(onDone).toHaveBeenCalledWith({
      query: SITES,
      parameters: { site: { literal: '7' } },
      mode: 'checked',
      take: { column: 'id' },
    });
  });

  it('places nothing on Cancel or Escape', async () => {
    const user = userEvent.setup();
    const { onDone, onCancel } = dialog();
    await screen.findByRole('radio', { name: /Site by id/ });
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('warns which documents will hold no value, naming those the author reads and counting the rest, unless only the value taken or the mode changed', async () => {
    const user = userEvent.setup();
    dialog(
      { current: bound },
      {
        holders: {
          documents: { readable: [{ id: 'd1', title: 'Site report' }], others: 2 },
        },
      },
    );
    const site = await screen.findByLabelText('site');
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Column'), 'id');
    await user.click(screen.getByRole('radio', { name: /Pinned/ }));
    expect(screen.queryByText(/will hold no value/)).toBeNull();
    await user.clear(site);
    await user.type(site, '2');
    expect(
      await screen.findByText(
        '3 documents will hold no value for it until resolved again: Site report and 2 you cannot read.',
      ),
    ).toBeInTheDocument();
  });

  it('says who may resolve a value an author may not resolve themselves', async () => {
    dialog({}, { mayUse: false });
    await userEvent.click(await screen.findByRole('radio', { name: /Site by id/ }));
    expect(
      await screen.findByText(
        "You may not use this definition's connection: it holds no value here until somebody who may use it resolves it.",
      ),
    ).toBeInTheDocument();
  });

  it('says a value placed at a pinned node shows once the node takes a version holding it', async () => {
    dialog({ inDocument: { pinned: true } });
    expect(
      await screen.findByText(
        'It shows in this document once the node takes a version holding it.',
      ),
    ).toBeInTheDocument();
  });

  it('says a component on its own shows its value in each document', async () => {
    dialog({ inDocument: null });
    await waitFor(() =>
      expect(
        screen.getByText('The value will show in each document that resolves it.'),
      ).toBeInTheDocument(),
    );
  });

  it('has words for each identity and each rule a value breaks, with no fancy dash', () => {
    expect(Object.keys(RUNS_AS)).toEqual(['service', 'endUser']);
    expect(Object.keys(PARAMETER_WORDS)).toEqual([
      'required',
      'type',
      'permitted',
      'range',
      'list',
      'precision',
      'scale',
      'zone',
      'variation',
    ]);
    const fancy = new RegExp(`[${String.fromCodePoint(0x2013, 0x2014)}]`);
    for (const words of [...Object.values(RUNS_AS), ...Object.values(PARAMETER_WORDS)]) {
      expect(words).not.toMatch(fancy);
    }
  });
});
