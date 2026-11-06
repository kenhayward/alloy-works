import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NewDocument } from './NewDocument.js';
import { client, json, DOCUMENT, SPACE, SPACES } from './test/documentPage.js';

const REGULATORY = 'aaaaaaaa-0000-4000-8000-000000000003';
const REPORT = 'ee000000-0000-4000-8000-000000000001';
const NOTICE = 'ee000000-0000-4000-8000-000000000002';
const DOSSIER = 'ee000000-0000-4000-8000-000000000003';

const summary = {
  description: null,
  sections: 0,
  values: 0,
  requiredValues: 0,
  copied: 0,
  referenced: 0,
  headings: [],
  isDefault: false,
};
const offer = (id: string, name: string, space: { id: string; name: string }, more = {}) => ({
  id,
  name,
  space,
  version: { id: `${id.slice(0, -2)}a1`, number: '0.3' },
  changedAt: '2026-11-01T09:00:00Z',
  ...summary,
  ...more,
});
const GENERAL = { id: SPACE, name: 'General' };
const TEMPLATES = {
  items: [
    offer(DOSSIER, 'Dossier', { id: REGULATORY, name: 'Regulatory' }, { sections: 6 }),
    offer(NOTICE, 'Notice', GENERAL, { sections: 1, values: 0, referenced: 1 }),
    offer(REPORT, 'Report', GENERAL, {
      description: 'A monthly report on the dosing trial.',
      sections: 3,
      values: 2,
      requiredValues: 2,
      copied: 1,
      referenced: 1,
      headings: ['Summary', 'Method', 'Results'],
      isDefault: true,
    }),
  ],
  next: null,
};

const feeds = { arguments: true };
const DECLARED = [
  {
    name: 'due',
    label: 'Due date',
    type: { base: 'date' },
    required: true,
    list: false,
    changeable: false,
    feeds,
  },
  { name: 'region', type: { base: 'text' }, required: true, list: false, changeable: false, feeds },
];
const definition = (parameters: unknown[]) => ({
  id: REPORT,
  space: GENERAL,
  version: { id: 'ee000000-0000-4000-8000-0000000000a1', number: '0.3', note: null },
  definition: {
    schemaVersion: 1,
    name: 'Report',
    theme: 'aaaaaaaa-0000-4000-8000-000000000011',
    layout: 'aaaaaaaa-0000-4000-8000-000000000012',
    schemas: [],
    outline: { sections: [] },
    changes: { add: true, remove: true, reorder: true },
    parameters,
  },
  mayDesign: false,
});

function service() {
  const sent: { url: string; body: unknown }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url).pathname;
    const body = request.method === 'GET' ? undefined : await request.clone().json();
    sent.push({ url, body });
    if (url === '/v1/spaces') return json(200, SPACES);
    if (url === '/v1/templates') return json(200, TEMPLATES);
    if (url.startsWith('/v1/templates/')) {
      return json(200, definition(url.endsWith(REPORT) ? DECLARED : []));
    }
    if (url.endsWith('/documents')) return json(201, { id: DOCUMENT });
    return json(500, {});
  }) as typeof globalThis.fetch;
  return { fetch, made: () => sent.filter((each) => each.url.endsWith('/documents')) };
}

const option = (name: string) => screen.getByRole('option', { name });
const create = () => screen.getByRole('button', { name: 'Create document' });

async function open(onCreated = vi.fn(), onCancel = vi.fn()) {
  const { fetch, made } = service();
  render(<NewDocument client={client(fetch)} onCreated={onCreated} onCancel={onCancel} />);
  await waitFor(() => expect(option('Report')).toHaveAttribute('aria-selected', 'true'));
  return { made, onCreated, onCancel };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('New document, a gallery of templates (the ND plan)', () => {
  it("TPL-077 lists the templates by space, the Where space's first with its default chosen, each with its summary", async () => {
    await open();
    const gallery = screen.getByRole('listbox', { name: 'Template' });
    expect(
      within(gallery)
        .getAllByRole('group')
        .map((each) => each.getAttribute('aria-label')),
    ).toEqual(['General', 'Regulatory']);
    // The default first in its space, then the rest as listed.
    expect(
      within(gallery)
        .getAllByRole('option')
        .map((each) => each.textContent),
    ).toEqual([
      expect.stringMatching(/^Report/),
      expect.stringMatching(/^Notice/),
      expect.stringMatching(/^Dossier/),
    ]);
    expect(option('Report')).toHaveAccessibleDescription('3 sections · 2 values');
    expect(
      screen.getByText(
        (_, element) => element?.tagName === 'P' && element.textContent === 'Template · General',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Report', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('A monthly report on the dosing trial.')).toBeInTheDocument();
    expect(screen.getByText('3 sections, 2 components')).toBeInTheDocument();
  });

  it("TPL-074 offers the Where space's Blank where it has none chosen yet, and sends no template for it", async () => {
    const { made, onCreated } = await open();
    await userEvent.selectOptions(screen.getByLabelText('Where'), 'Regulatory');
    // Nothing was picked, so the choice follows Where to its default: Blank, made when first used.
    const blank = await screen.findByRole('option', { name: 'Blank' });
    expect(blank).toHaveAttribute('aria-selected', 'true');
    expect(blank).toHaveAccessibleDescription('One component to start');
    expect(
      screen.getByText(
        'Blank asks for nothing. It starts with one component to write in, so there is somewhere to type straight away.',
      ),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Title'), 'The dosing report');
    expect(screen.getByText('Creates a document with one component, in Regulatory.')).toBeVisible();
    await userEvent.click(create());
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(DOCUMENT));
    expect(made()).toEqual([
      {
        url: `/v1/spaces/${REGULATORY}/documents`,
        body: { title: 'The dosing report', language: 'en-GB', direction: 'ltr' },
      },
    ]);
  });

  it('TPL-077 finds a template by its name or its space as typed, and says when none is called that', async () => {
    await open();
    const find = screen.getByRole('searchbox', { name: 'Find a template' });
    await userEvent.type(find, 'regul');
    expect(
      within(screen.getByRole('listbox'))
        .getAllByRole('option')
        .map((each) => each.textContent),
    ).toEqual([expect.stringContaining('Dossier')]);
    await userEvent.clear(find);
    await userEvent.type(find, 'zzz');
    expect(within(screen.getByRole('listbox')).queryAllByRole('option')).toEqual([]);
    expect(screen.getByText('No template is called that.')).toBeInTheDocument();
  });

  it('TPL-077 moves the choice with the arrow keys, Home and End, and sends typing to Find', async () => {
    await open();
    const gallery = screen.getByRole('listbox', { name: 'Template' });
    gallery.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(option('Notice')).toHaveAttribute('aria-selected', 'true');
    expect(gallery).toHaveAttribute('aria-activedescendant', option('Notice').id);
    await userEvent.keyboard('{End}');
    expect(option('Dossier')).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Home}');
    expect(option('Report')).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('d');
    expect(screen.getByRole('searchbox', { name: 'Find a template' })).toHaveFocus();
    expect(screen.getByRole('searchbox', { name: 'Find a template' })).toHaveValue('d');
  });

  it('TPL-076 shows a value by its label, and by its key where it has none', async () => {
    await open();
    expect(await screen.findByLabelText('Due date (required)')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('region (required)')).toBeInTheDocument();
    expect(create()).toHaveAccessibleDescription(
      'Fill in Due date and region to create the document.',
    );
  });

  it('TPL-077 counts the required values left, and edges them only once asked: by Create, or by the count, which goes to the first', async () => {
    const { made } = await open();
    const due = await screen.findByLabelText('Due date (required)');
    expect(screen.getByRole('group', { name: 'Values for this template' })).toHaveAttribute(
      'tabindex',
      '0',
    );
    expect(screen.getByText('2 values · 2 required')).toBeInTheDocument();
    expect(due.closest('[data-warn]')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '2 required values left' }));
    expect(due).toHaveFocus();
    expect(due.closest('[data-warn]')).not.toBeNull();
    fireEvent.change(due, { target: { value: '2026-10-31' } });
    expect(screen.getByRole('button', { name: '1 required value left' })).toBeInTheDocument();
    expect(due.closest('[data-warn]')).toBeNull();
    await userEvent.click(create());
    expect(made()).toEqual([]);
  });

  it('says what Create will make and where, and Cancel closes without making anything', async () => {
    const { made, onCancel } = await open();
    await userEvent.click(option('Notice'));
    expect(screen.getByText('Creates 1 section from the template, in General.')).toBeVisible();
    expect(screen.getByText('Notice asks for no values.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(made()).toEqual([]);
  });

  it('chooses the direction from a pair of radio buttons, and starts in Title', async () => {
    const { made, onCreated } = await open();
    expect(screen.getByLabelText('Title')).toHaveAttribute('data-autofocus');
    const direction = screen.getByRole('radiogroup', { name: 'Direction' });
    expect(within(direction).getByRole('radio', { name: 'Left to right' })).toBeChecked();
    await userEvent.click(within(direction).getByRole('radio', { name: 'Right to left' }));
    await userEvent.click(option('Notice'));
    await userEvent.type(screen.getByLabelText('Title'), 'The dosing report');
    await userEvent.click(create());
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(made()[0]?.body).toMatchObject({ direction: 'rtl', template: NOTICE });
  });

  it('offers the templates as a select in a narrow window', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width'),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const { fetch } = service();
    render(<NewDocument client={client(fetch)} onCreated={vi.fn()} />);
    const select = await screen.findByRole('combobox', { name: 'Template' });
    await waitFor(() => expect(select).toHaveValue(REPORT));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(
      [...select.querySelectorAll('optgroup')].map((each) => each.getAttribute('label')),
    ).toEqual(['General', 'Regulatory']);
  });
});
