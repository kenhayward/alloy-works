import { createApiClient } from '@alloy-works/api-client';
import type { Binding, TemplateParameter } from '@alloy-works/domain';
import { render, screen, waitFor, within } from '@testing-library/react';
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
      'position',
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
    // As a figure asked only of an image column; in the line or as a table of any (TB2-E).
    expect(screen.queryByRole('radio', { name: 'As a figure' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'As a table' })).toBeInTheDocument();
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
    expect([...(column as HTMLSelectElement).options].map((each) => each.value)).toEqual(['photo']);
    expect(screen.queryByRole('radio', { name: 'In the line' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(onDone).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: { column: 'photo' } }),
      'figure',
    );
  });

  it('has words for each place with no fancy dash', () => {
    const fancy = new RegExp(`[${String.fromCodePoint(0x2013, 0x2014)}]`);
    expect(Object.values(PLACE_AS)).toEqual(['In the line', 'As a figure', 'As a table']);
    for (const words of Object.values(PLACE_AS)) expect(words).not.toMatch(fancy);
  });
});

describe('a table in the Value dialog (the TB2 plan, TB2-E and TB2-G)', () => {
  const declared = view().definition.columns;

  it('places the whole result as a table where a block may go, asking no column and no row', async () => {
    const user = userEvent.setup();
    const { onDone } = dialog({ place: 'offer' });
    await user.click(await screen.findByRole('radio', { name: /Site by id/ }));
    await user.type(await screen.findByLabelText('site'), '7');
    await user.click(screen.getByRole('radio', { name: 'As a table' }));
    expect(screen.queryByLabelText('Column')).toBeNull();
    expect(screen.queryByRole('radio', { name: 'The only row' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Insert' }));
    expect(onDone).toHaveBeenLastCalledWith(
      { query: SITES, parameters: { site: { literal: '7' } }, mode: 'checked' },
      'table',
      declared,
    );
  });

  it("changes a bound table's binding, asking no column and offering no other place", async () => {
    const user = userEvent.setup();
    const { onDone } = dialog({
      place: 'table',
      current: { type: 'binding', id: 'b1', query: SITES, parameters: {}, mode: 'checked' },
    });
    await user.click(await screen.findByRole('radio', { name: /Visits by person/ }));
    expect(screen.queryByLabelText('Column')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Place as' })).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Change' }));
    expect(onDone).toHaveBeenLastCalledWith(
      { query: VISITS, parameters: {}, mode: 'checked' },
      'table',
      declared,
    );
  });
});

/** A template's parameter, as `GET /v1/documents/{id}/parameters` declares it. */
const offered = (
  name: string,
  base: 'integer' | 'date',
  over: { list?: boolean; argues?: boolean } = {},
): TemplateParameter => ({
  name,
  type: { base } as TemplateParameter['type'],
  required: false,
  list: over.list ?? false,
  changeable: true,
  feeds: { arguments: over.argues ?? true },
});

const fromDocument: Binding = { ...bound, parameters: { site: { document: 'site_no' } } };

describe("the Value dialog's From the document (the TP2 plan, TP2-F)", () => {
  it("DAT-030 offers only the document's parameters that feed values and match the parameter's type and list, and writes the one chosen", async () => {
    const user = userEvent.setup();
    const { onDone } = dialog({
      documentParameters: {
        declarations: [
          offered('site_no', 'integer'),
          offered('issued', 'date'),
          offered('count', 'integer', { argues: false }),
          offered('sites', 'integer', { list: true }),
          offered('lot', 'integer'),
        ],
      },
    });
    await user.click(await screen.findByRole('radio', { name: /Site by id/ }));
    await user.click(await screen.findByRole('checkbox', { name: 'Take site from the document' }));
    expect(screen.queryByLabelText('site')).toBeNull();
    const chosen = screen.getByRole('combobox', { name: 'Document parameter for site' });
    expect(
      within(chosen)
        .getAllByRole('option')
        .map((each) => each.textContent),
    ).toEqual(['site_no', 'lot']);
    await user.selectOptions(chosen, 'lot');
    await user.click(screen.getByRole('button', { name: 'Insert' }));
    expect(onDone).toHaveBeenCalledWith(
      {
        query: SITES,
        parameters: { site: { document: 'lot' } },
        mode: 'checked',
        take: { column: 'id' },
      },
      'line',
    );
  });

  it("tells a reader without the template's declarations why none is offered, and takes a typed name", async () => {
    const user = userEvent.setup();
    const { onDone } = dialog({ documentParameters: { none: 'unreadable' } });
    await user.click(await screen.findByRole('radio', { name: /Site by id/ }));
    await user.click(await screen.findByRole('checkbox', { name: 'Take site from the document' }));
    expect(
      screen.getByText(
        "You may not read this document's template, so its parameters cannot be offered. Type the name of the one this value takes.",
      ),
    ).toBeInTheDocument();
    await user.type(
      screen.getByLabelText('Name of the document parameter for site'),
      'site_no{Enter}',
    );
    expect(onDone).toHaveBeenCalledWith(
      expect.objectContaining({ parameters: { site: { document: 'site_no' } } }),
      'line',
    );
  });

  it("takes a typed name in a component alone, held to a parameter's name", async () => {
    const user = userEvent.setup();
    const { onDone } = dialog({ inDocument: null });
    await user.click(await screen.findByRole('radio', { name: /Site by id/ }));
    await user.click(await screen.findByRole('checkbox', { name: 'Take site from the document' }));
    expect(
      screen.getByText(
        'A component alone has no document to offer parameters. Type the name of the one this value takes.',
      ),
    ).toBeInTheDocument();
    const name = screen.getByLabelText('Name of the document parameter for site');
    await user.type(name, 'Site No{Enter}');
    expect(
      await screen.findByText(
        'site takes a name of lower-case letters, digits and underscores, beginning with a letter.',
      ),
    ).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    await user.clear(name);
    await user.type(name, 'site_no{Enter}');
    expect(onDone).toHaveBeenCalledWith(
      expect.objectContaining({ parameters: { site: { document: 'site_no' } } }),
      'line',
    );
  });

  it('opens a binding that takes a parameter from the document with it chosen', async () => {
    dialog({
      current: fromDocument,
      documentParameters: {
        declarations: [offered('lot', 'integer'), offered('site_no', 'integer')],
      },
    });
    expect(
      await screen.findByRole('checkbox', { name: 'Take site from the document' }),
    ).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Document parameter for site' })).toHaveValue(
      'site_no',
    );
  });

  it('warns no holder where only the value taken changed on a binding taking a parameter from the document (TP2-D)', async () => {
    const user = userEvent.setup();
    dialog(
      {
        current: fromDocument,
        documentParameters: { declarations: [offered('site_no', 'integer')] },
      },
      { holders: { documents: { readable: [{ id: 'd1', title: 'Site report' }], others: 0 } } },
    );
    await screen.findByRole('checkbox', { name: 'Take site from the document' });
    await user.selectOptions(screen.getByLabelText('Column'), 'id');
    expect(screen.queryByText(/will hold no value/)).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Take site from the document' }));
    await user.type(screen.getByLabelText('site'), '2');
    expect(
      await screen.findByText(
        'One document will hold no value for it until resolved again: Site report.',
      ),
    ).toBeInTheDocument();
  });
});
