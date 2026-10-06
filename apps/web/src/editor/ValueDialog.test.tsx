import { createApiClient } from '@alloy-works/api-client';
import type { Binding } from '@alloy-works/domain';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PARAMETER_WORDS, PLACE_AS, RUNS_AS, ValueDialog } from './ValueDialog.js';

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

const FAR = '44444444-4444-4444-8444-444444444444';
const OLDER = '55555555-5555-4555-8555-555555555550';
const VISITS_LATEST = '55555555-5555-4555-8555-555555555552';

const view = (mayUse = true, id = SITES, title = 'Site by id', version = LATEST) => ({
  id,
  space: { id: '11111111-1111-4111-8111-111111111111', name: 'General' },
  version: { id: version, number: '0.3', author: null, createdAt: '', note: null },
  definition: {
    title,
    parameters:
      id === VISITS
        ? []
        : [{ name: 'site', type: { base: 'integer' }, required: true, list: false }],
    columns: [
      { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
      { name: 'name', from: { column: 'name' }, type: { base: 'text' } },
      // An image column (the B6 plan, B6-H), described by the name in its row.
      {
        name: 'photo',
        from: { column: 'photo' },
        type: { base: 'image', encoding: 'binary', description: { column: 'name' } },
      },
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
    if (path === `/v1/query-definitions/${VISITS}`) {
      return json(200, view(true, VISITS, 'Visits by person', VISITS_LATEST));
    }
    // Readable by its identifier, beyond the first page of the listing.
    if (path === `/v1/query-definitions/${FAR}`) {
      return json(200, view(true, FAR, 'Far sites'));
    }
    if (path.endsWith('/holders')) {
      return json(200, answers.holders ?? { documents: { readable: [], others: 0 } });
    }
    return json(404, { code: 'not_found', message: 'No.' });
  }) as unknown as typeof fetch;
  const onDone = vi.fn(() => null);
  const onCancel = vi.fn();
  // A control either side of the dialog, which a Tab must never reach while it is open.
  render(
    <>
      <button type="button">Before</button>
      <ValueDialog
        client={createApiClient({ baseUrl: 'http://value.test', fetch: fetching })}
        componentId={COMPONENT}
        current={null}
        inDocument={{ pinned: false }}
        onDone={onDone}
        onCancel={onCancel}
        {...over}
      />
      <button type="button">After</button>
    </>,
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
    expect(onDone).toHaveBeenCalledWith(
      {
        query: SITES,
        parameters: { site: { literal: '7' } },
        mode: 'checked',
        take: { column: 'id' },
      },
      'line',
    );
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

  it('changes to another definition at its latest, carrying no pin from the definition it leaves', async () => {
    const user = userEvent.setup();
    const { onDone } = dialog({ current: { ...bound, version: OLDER } });
    expect(await screen.findByRole('radio', { name: 'The version it pins now' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: /Visits by person/ }));
    expect(await screen.findByRole('radio', { name: 'Always the latest' })).toBeChecked();
    expect(screen.queryByRole('radio', { name: 'The version it pins now' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(onDone).toHaveBeenCalledWith(
      { query: VISITS, parameters: {}, mode: 'checked', take: { column: 'name' } },
      'line',
    );
    // Back to the definition it binds: the version it pins is its own again.
    await user.click(screen.getByRole('radio', { name: /Site by id/ }));
    expect(await screen.findByRole('radio', { name: 'The version it pins now' })).toBeChecked();
  });

  it('moves the focus from the search to the list and on to Cancel before a definition is chosen, never leaving the dialog', async () => {
    const user = userEvent.setup();
    dialog();
    await screen.findByRole('radio', { name: /Site by id/ });
    const search = screen.getByLabelText('Find a query definition by title');
    expect(search).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('radio', { name: /Site by id/ })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab();
    expect(search).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('opens on a definition beyond the first page of the listing by its title, not as one it cannot read', async () => {
    dialog({ current: { ...bound, query: FAR } });
    expect(await screen.findByRole('radio', { name: /Far sites/ })).toBeChecked();
    expect(screen.queryByText('a query definition you cannot read')).toBeNull();
    expect(screen.queryByText(/You may not read this query definition/)).toBeNull();
  });

  it('places nothing while a value does not fit its parameter', async () => {
    const user = userEvent.setup();
    const { onDone } = dialog();
    await user.click(await screen.findByRole('radio', { name: /Site by id/ }));
    await user.type(await screen.findByLabelText('site'), 'north{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A value does not fit its parameter.',
    );
    expect(onDone).not.toHaveBeenCalled();
  });

  it('places the binding in the mode chosen', async () => {
    const user = userEvent.setup();
    const { onDone } = dialog();
    await user.click(await screen.findByRole('radio', { name: /Site by id/ }));
    await user.type(await screen.findByLabelText('site'), '7');
    await user.click(screen.getByRole('radio', { name: /Pinned/ }));
    await user.click(screen.getByRole('button', { name: 'Insert' }));
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ mode: 'pinned' }), 'line');
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

describe('an image column in the Value dialog (the B6 plan, B6-H)', () => {
  const choosePhoto = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('radio', { name: /Site by id/ }));
    await user.type(await screen.findByLabelText('site'), '7');
    await user.selectOptions(screen.getByLabelText('Column'), 'photo');
  };
  const photo = {
    query: SITES,
    parameters: { site: { literal: '7' } },
    mode: 'checked',
    take: { column: 'photo' },
  };

  it('DAT-098 offers an image column, and places it in the line or as a figure, as the author answers Place as', async () => {
    const user = userEvent.setup();
    const { onDone } = dialog({ place: 'offer' });
    await user.click(await screen.findByRole('radio', { name: /Site by id/ }));
    await screen.findByLabelText('site');
    // Asked only of an image column.
    expect(screen.queryByRole('group', { name: 'Place as' })).toBeNull();
    expect(screen.getByRole('option', { name: 'photo, an image' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('site'), '7');
    await user.selectOptions(screen.getByLabelText('Column'), 'photo');
    expect(screen.getByRole('radio', { name: 'In the line' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Insert' }));
    expect(onDone).toHaveBeenLastCalledWith(photo, 'line');
    await user.click(screen.getByRole('radio', { name: 'As a figure' }));
    await user.click(screen.getByRole('button', { name: 'Insert' }));
    expect(onDone).toHaveBeenLastCalledWith(photo, 'figure');
  });

  it('places an image column in the line, asking nothing, where no figure may go', async () => {
    const user = userEvent.setup();
    const { onDone } = dialog({ place: 'line' });
    await choosePhoto(user);
    expect(screen.queryByRole('radio', { name: 'As a figure' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Insert' }));
    expect(onDone).toHaveBeenLastCalledWith(photo, 'line');
  });

  it("offers image columns alone when it changes a bound figure's binding", async () => {
    const user = userEvent.setup();
    const { onDone } = dialog({
      place: 'figure',
      current: { ...bound, take: { column: 'photo' } },
    });
    const column = await screen.findByLabelText('Column');
    expect(
      [...(column as HTMLSelectElement).options].map((each) => each.value),
    ).toEqual(['photo']);
    expect(screen.queryByRole('radio', { name: 'In the line' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(onDone).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: { column: 'photo' } }),
      'figure',
    );
  });

  it('has words for each place with no fancy dash', () => {
    const fancy = new RegExp(`[${String.fromCodePoint(0x2013, 0x2014)}]`);
    expect(Object.values(PLACE_AS)).toEqual(['In the line', 'As a figure']);
    for (const words of Object.values(PLACE_AS)) expect(words).not.toMatch(fancy);
  });
});
