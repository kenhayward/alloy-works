import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComponentList } from './ComponentList.js';
import { content } from './test/componentEditor.js';

const GENERAL = '1a1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';
const TRAINING = '2b1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';
const PRINTER = '3c1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';
const TONER = '4d1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const row = (id: string, title: string, space: string, by: { id: string; name: string }) => ({
  id,
  title,
  space: { id: space, name: space === GENERAL ? 'General' : 'Training' },
  version: '0.2',
  type: 'Topic',
  language: 'en-GB',
  changedAt: new Date(2025, 11, 3, 11, 0).toISOString(),
  changedBy: by,
  state: { key: 'in_review', name: 'In review' },
});

const SPACES = [
  { id: GENERAL, name: 'General', count: 1 },
  { id: TRAINING, name: 'Training', count: 1 },
];

/** The service: both components unfiltered, and only a space's own when the filter names it. */
function service({ creatable = true } = {}) {
  const asked: string[] = [];
  // What is archived, as the archive and unarchive routes leave it.
  const archived = new Set<string>();
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/v1/spaces') {
      return json(200, {
        items: [{ id: GENERAL, name: 'General', mayCreate: creatable }],
        next: null,
      });
    }
    if (url.pathname === `/v1/spaces/${GENERAL}/component-types`) {
      return json(200, { items: [{ id: 't1', name: 'Topic', isDefault: true }], next: null });
    }
    if (url.pathname === '/v1/access') {
      // The reader administers the printer, and only reads the toner.
      const target = url.searchParams.get('target') ?? '';
      return json(200, {
        target,
        permissions: [
          { permission: 'read', allowed: true },
          { permission: 'administer', allowed: target === `artifact:${PRINTER}` },
          { permission: 'retire', allowed: target === `artifact:${PRINTER}` },
        ],
      });
    }
    if (url.pathname === '/v1/deleted') {
      asked.push(`deleted ${url.searchParams.get('kind')}`);
      return json(200, {
        items: [
          {
            id: 'd1',
            kind: 'component',
            title: 'Calibrate the scanner',
            space: { id: GENERAL, name: 'General' },
            deletedBy: { id: 'p1', name: 'Ada' },
            deletedAt: new Date(2026, 9, 13, 9, 0).toISOString(),
            mayUndelete: true,
          },
        ],
        next: null,
        total: 1,
      });
    }
    const acted = /^\/v1\/components\/([^/]+)\/(archive|unarchive)$/.exec(url.pathname);
    if (acted && request.method === 'POST') {
      if (acted[2] === 'archive') archived.add(acted[1]!);
      else archived.delete(acted[1]!);
      return json(200, { archived: acted[2] === 'archive' });
    }
    if (url.pathname === `/v1/components/${PRINTER}/versions`) {
      return json(200, {
        items: [
          {
            id: 'v2',
            number: '0.2',
            createdAt: new Date(2025, 11, 3, 11, 0).toISOString(),
            author: { id: 'p1', name: 'Ada' },
            note: 'Final torque raised',
          },
          {
            id: 'v1',
            number: '0.1',
            createdAt: new Date(2025, 10, 21, 9, 0).toISOString(),
            author: { id: 'p2', name: 'Grace' },
            note: null,
          },
        ],
        next: null,
      });
    }
    if (url.pathname === `/v1/components/${PRINTER}`) {
      return json(200, { id: PRINTER, content: content('Unbox the printer.', 'Keep the box.') });
    }
    if (url.pathname !== '/v1/components') return json(404, {});
    const spaces = url.searchParams.get('spaces');
    asked.push(spaces ?? 'all');
    const only = url.searchParams.get('archived') === 'only';
    const items = [
      row(PRINTER, 'Install the printer', GENERAL, { id: 'p1', name: 'Ada' }),
      row(TONER, 'Replace the toner', TRAINING, { id: 'p2', name: 'Grace' }),
    ]
      .filter((item) => spaces === null || spaces.split(',').includes(item.space.id))
      .filter((item) => archived.has(item.id) === only);
    return json(200, { items, next: null, total: items.length, spaces: SPACES });
  }) as unknown as typeof fetch;
  const client = createApiClient({ baseUrl: 'http://list.test', fetch: fetching });
  return { client, asked };
}

afterEach(() => window.localStorage.clear());

describe('the components list', () => {
  it('shows each component as a row: title linking to it, its space and language beneath, type, version, when changed and by whom', async () => {
    const { client } = service();
    render(<ComponentList client={client} principalId="p9" />);

    const link = await screen.findByRole('link', { name: 'Replace the toner' });
    expect(link).toHaveAttribute('href', `#/components/${TONER}`);
    const cells = within(link.closest('tr')!).getAllByRole('cell');
    expect(within(cells[0]!).getByText('Training, en-GB')).toBeInTheDocument();
    // The seventh cell holds the row's buttons.
    expect(cells.slice(1, 6).map((cell) => cell.textContent)).toEqual([
      'Topic',
      '0.2',
      'In review',
      '3 Dec 2025',
      'Grace',
    ]);
    expect(screen.getByRole('heading', { name: 'Components' })).toBeInTheDocument();
    expect(screen.getByText('2 components you may read. Showing 1 to 2.')).toBeInTheDocument();
  });

  it('filters by space, and clears the filter', async () => {
    const { client, asked } = service();
    render(<ComponentList client={client} principalId="p9" />);
    await screen.findByRole('link', { name: 'Replace the toner' });

    await userEvent.click(screen.getByRole('checkbox', { name: /General/ }));
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Replace the toner' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: 'Install the printer' })).toBeInTheDocument();
    expect(asked).toContain(GENERAL);
    expect(screen.getByText(/^1 component you may read\. Showing 1 to 1\./)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(await screen.findByRole('link', { name: 'Replace the toner' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /General/ })).not.toBeChecked();
  });

  it('shows each chosen filter as a chip above the list, which removes it', async () => {
    const { client } = service();
    render(<ComponentList client={client} principalId="p9" />);
    await screen.findByRole('link', { name: 'Replace the toner' });

    await userEvent.click(screen.getByRole('checkbox', { name: /General/ }));
    const chips = await screen.findByRole('list', { name: 'Filtered by' });
    await userEvent.click(within(chips).getByRole('button', { name: 'Remove General' }));

    expect(await screen.findByRole('link', { name: 'Replace the toner' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Filtered by' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /General/ })).not.toBeChecked();
  });

  it('shows the chosen component beside the list: its facts, Open, Give access, its text and its latest versions', async () => {
    const { client } = service();
    render(<ComponentList client={client} principalId="p9" />);
    const show = await screen.findByRole('button', { name: 'Show Install the printer here' });

    await userEvent.click(show);

    expect(show).toHaveAttribute('aria-pressed', 'true');
    const panel = screen.getByRole('complementary', { name: 'Install the printer' });
    for (const fact of ['Topic', '0.2', 'General', 'en-GB']) {
      expect(within(panel).getByText(fact, { selector: '[data-tone]' })).toBeInTheDocument();
    }
    expect(within(panel).getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      `#/components/${PRINTER}`,
    );
    expect(within(panel).getByRole('link', { name: 'Give access' })).toHaveAttribute(
      'href',
      `#/components/${PRINTER}/access`,
    );
    expect(await within(panel).findByText('Unbox the printer. Keep the box.')).toBeInTheDocument();
    const versions = within(panel).getByRole('list', { name: 'Versions' });
    expect(
      within(versions)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['0.2Ada, 3 DecFinal torque raised', '0.1Grace, 21 Nov']);

    await userEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'Install the printer' })).toBeNull();
    expect(show).toHaveFocus();
  });

  it('opens New component as a dialog from the primary button', async () => {
    const { client } = service();
    render(<ComponentList client={client} principalId="p9" />);
    await screen.findByRole('link', { name: 'Replace the toner' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'New component' }));

    const dialog = screen.getByRole('dialog', { name: 'New component' });
    expect(await within(dialog).findByRole('combobox', { name: 'Where' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers no New component to a reader with nowhere to create one', async () => {
    const { client } = service({ creatable: false });
    render(<ComponentList client={client} principalId="p9" />);
    await screen.findByRole('link', { name: 'Replace the toner' });

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'New component' })).not.toBeInTheDocument(),
    );
  });

  it('offers Open and Copy link in a row menu, and Manage access only where it is allowed', async () => {
    const { client } = service();
    render(<ComponentList client={client} principalId="p9" />);
    await screen.findByRole('link', { name: 'Replace the toner' });

    await userEvent.click(screen.getByRole('button', { name: 'Actions for Install the printer' }));
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      `#/components/${PRINTER}`,
    );
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Manage access' })).toHaveAttribute(
      'href',
      `#/components/${PRINTER}/access`,
    );
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('link', { name: 'Open' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions for Install the printer' })).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'Actions for Replace the toner' }));
    expect(screen.getByRole('link', { name: 'Open' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Manage access' })).not.toBeInTheDocument(),
    );
  });

  it('LIF-020 offers Archive to whoever may retire it, and lists the archived alone under Archived, each to unarchive', async () => {
    const user = userEvent.setup();
    const { client } = service();
    render(<ComponentList client={client} principalId="p9" />);
    await screen.findByRole('link', { name: 'Replace the toner' });

    await user.click(screen.getByRole('button', { name: 'Actions for Replace the toner' }));
    expect(await screen.findByRole('link', { name: 'Open' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument(),
    );
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Actions for Install the printer' }));
    await user.click(await screen.findByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('Archived Install the printer.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Install the printer' })).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole('checkbox', { name: 'Archived' }));
    const link = await screen.findByRole('link', { name: 'Install the printer' });
    expect(within(link.closest('td')!).getByText('Archived')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Replace the toner' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Actions for Install the printer' }));
    await user.click(await screen.findByRole('button', { name: 'Unarchive' }));
    expect(await screen.findByText('Unarchived Install the printer.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Install the printer' })).not.toBeInTheDocument(),
    );
  });

  it('lists the deleted components alone under Deleted, each to undelete, and back again', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<ComponentList client={client} principalId="p9" />);
    await screen.findByRole('link', { name: 'Replace the toner' });
    await user.click(screen.getByRole('checkbox', { name: 'Deleted' }));
    const table = await screen.findByRole('table', { name: 'Deleted components' });
    expect(within(table).getByText('Calibrate the scanner')).toBeInTheDocument();
    expect(
      within(table).getByRole('button', { name: 'Undelete Calibrate the scanner' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Replace the toner' })).not.toBeInTheDocument();
    expect(asked).toContain('deleted component');
    await user.click(screen.getByRole('checkbox', { name: 'Deleted' }));
    expect(await screen.findByRole('link', { name: 'Replace the toner' })).toBeInTheDocument();
  });

  it("copies a component's link, and says so", async () => {
    const user = userEvent.setup();
    const { client } = service();
    render(<ComponentList client={client} principalId="p9" />);
    await screen.findByRole('link', { name: 'Replace the toner' });

    await user.click(screen.getByRole('button', { name: 'Actions for Replace the toner' }));
    await user.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(await screen.findByText('Copied the link to Replace the toner.')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(
      `${window.location.origin}${window.location.pathname}#/components/${TONER}`,
    );
  });

  it("says You for the reader's own change", async () => {
    const { client } = service();
    render(<ComponentList client={client} principalId="p1" />);

    const link = await screen.findByRole('link', { name: 'Install the printer' });
    const cells = within(link.closest('tr')!).getAllByRole('cell');
    expect(cells[5]).toHaveTextContent('You');
  });

  it('shows each component’s workflow state as its lozenge', async () => {
    const { client } = service();
    render(<ComponentList client={client} principalId="p9" />);
    const link = await screen.findByRole('link', { name: 'Replace the toner' });
    expect(within(link.closest('tr')!).getByText('In review')).toHaveAttribute(
      'data-kind',
      'inReview',
    );
  });
});
