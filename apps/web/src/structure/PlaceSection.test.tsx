import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PlaceIntoButton, PlaceSectionButton } from './PlaceSection.js';

const HANDBOOK = 'dddddddd-0000-4000-8000-000000000001';
const MANUAL = 'dddddddd-0000-4000-8000-000000000002';
const MANUAL_VERSION = 'dddddddd-0000-4000-8000-0000000000a2';
const OPENED = 'dddddddd-0000-4000-8000-0000000000a1';
const FLUSH = 'cccccccc-0000-4000-8000-000000000001';
const PRIME = 'cccccccc-0000-4000-8000-000000000002';
const SECTION = 's'.repeat(26);

const title = (value: string) => [{ type: 'text', value, marks: [] }];
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const report = (unreadable = 0) => ({
  from: {
    document: MANUAL,
    version: MANUAL_VERSION,
    section: { id: SECTION, title: title('Maintenance') },
  },
  occurrences: 3,
  components: [
    {
      id: FLUSH,
      title: 'Flush the line',
      occurrences: 2,
      blocks: 1,
      characters: 15,
      approved: false,
    },
    {
      id: PRIME,
      title: 'Prime the pump',
      occurrences: 1,
      blocks: 1,
      characters: 8,
      approved: true,
    },
  ],
  unreadable,
  blocks: 3,
  characters: 38,
});

function service(unreadable = 0, refuseFirst = false) {
  let refused = !refuseFirst;
  const asked: { method: string; path: string; body: unknown }[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const { pathname } = new URL(request.url);
    const body = request.method === 'POST' ? ((await request.json()) as unknown) : undefined;
    asked.push({ method: request.method, path: pathname, body });
    if (pathname === '/v1/documents') {
      return json(200, {
        items: [
          { id: HANDBOOK, title: 'Pump handbook' },
          { id: MANUAL, title: 'Pump manual' },
        ],
        next: null,
        total: 2,
      });
    }
    if (pathname === `/v1/documents/${MANUAL}`) {
      return json(200, {
        outline: {
          nodes: [{ type: 'section', id: SECTION, title: title('Maintenance'), children: [] }],
        },
      });
    }
    if (pathname === `/v1/documents/${HANDBOOK}`) {
      return json(200, { version: { id: OPENED }, outline: { nodes: [] } });
    }
    if (pathname === `/v1/documents/${HANDBOOK}/placement` && request.method === 'GET') {
      return json(200, report(unreadable));
    }
    if (pathname === `/v1/documents/${HANDBOOK}/placement`) {
      if (!refused) {
        refused = true;
        return json(409, { code: 'source_moved', message: 'Moved.', traceId: 't' });
      }
      return json(200, { placed: true });
    }
    return json(404, {});
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://place.test', fetch: fetching }), asked };
}

const choose = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Place from a document' }));
  const dialog = await screen.findByRole('dialog', { name: 'Place from a document' });
  // The document it is in is not offered.
  const documents = within(dialog).getByRole('combobox', { name: 'Document' });
  expect(within(documents).queryByRole('option', { name: 'Pump handbook' })).toBeNull();
  await userEvent.selectOptions(
    documents,
    await within(documents).findByRole('option', { name: 'Pump manual' }),
  );
  const sections = within(dialog).getByRole('combobox', { name: 'Section' });
  await userEvent.selectOptions(
    sections,
    await within(sections).findByRole('option', { name: 'Maintenance' }),
  );
  return dialog;
};

describe('Place in a document, from a section found (the R14 plan, R14-C)', () => {
  it('SCH-053 REU-054 places a found section in the document chosen, as Place from a document does there', async () => {
    const { client, asked } = service();
    const placed = vi.fn();
    render(<PlaceIntoButton client={client} from={MANUAL} section={SECTION} onPlaced={placed} />);
    await userEvent.click(screen.getByRole('button', { name: 'Place in a document' }));
    const dialog = await screen.findByRole('dialog', { name: 'Place in a document' });
    // The document it is in is not offered.
    const into = within(dialog).getByRole('combobox', { name: 'Into' });
    expect(within(into).queryByRole('option', { name: 'Pump manual' })).toBeNull();
    await userEvent.selectOptions(
      into,
      await within(into).findByRole('option', { name: 'Pump handbook' }),
    );
    expect(await within(dialog).findByRole('region', { name: 'What it places' })).toHaveTextContent(
      '3 references to 2 components',
    );
    expect(within(dialog).getByRole('textbox', { name: 'New section title' })).toHaveValue(
      'Maintenance',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Place' }));
    expect(placed).toHaveBeenCalledWith(HANDBOOK);
    expect(asked.find((each) => each.method === 'POST')).toMatchObject({
      path: `/v1/documents/${HANDBOOK}/placement`,
      body: { openedFrom: OPENED, from: MANUAL, fromVersion: MANUAL_VERSION, section: SECTION },
    });
  });
});

describe('Place from a document', () => {
  it('REU-046 REU-054 says how much a section pulls in, then places it under a new section in the mode chosen', async () => {
    const { client, asked } = service();
    const placed = vi.fn();
    render(
      <PlaceSectionButton
        client={client}
        documentId={HANDBOOK}
        openedFrom={OPENED}
        onPlaced={placed}
      />,
    );
    const dialog = await choose();

    const said = await within(dialog).findByRole('region', { name: 'What it places' });
    expect(said).toHaveTextContent(
      '3 references to 2 components: 3 blocks, 38 characters of text.',
    );
    expect(
      within(said)
        .getAllByRole('listitem')
        .map((each) => each.textContent),
    ).toEqual(['Flush the line, 2 times', 'Prime the pump']);
    expect(asked.some((each) => each.method === 'POST')).toBe(false);

    await userEvent.click(
      within(dialog).getByRole('radio', { name: 'Pin each to its version now' }),
    );
    const named = within(dialog).getByRole('textbox', { name: 'New section title' });
    expect(named).toHaveValue('Maintenance');
    await userEvent.clear(named);
    await userEvent.type(named, 'Upkeep');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Place' }));

    expect(placed).toHaveBeenCalledWith({ placed: true });
    expect(asked.find((each) => each.method === 'POST')?.body).toEqual({
      openedFrom: OPENED,
      from: MANUAL,
      fromVersion: MANUAL_VERSION,
      section: SECTION,
      parent: null,
      position: 0,
      title: title('Upkeep'),
      mode: 'pinned',
    });
  });

  it('offers nothing to place where the section places a component the author may not read', async () => {
    const { client } = service(1);
    render(
      <PlaceSectionButton
        client={client}
        documentId={HANDBOOK}
        openedFrom={OPENED}
        onPlaced={() => undefined}
      />,
    );
    const dialog = await choose();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'It places 1 component you may not read or that was deleted, so it cannot be placed.',
    );
    expect(within(dialog).getByRole('button', { name: 'Place' })).toBeDisabled();
  });

  it('reads the report again where the section moved since, keeping the title the author typed', async () => {
    const { client, asked } = service(0, true);
    const placed = vi.fn();
    render(
      <PlaceSectionButton
        client={client}
        documentId={HANDBOOK}
        openedFrom={OPENED}
        onPlaced={placed}
      />,
    );
    const dialog = await choose();
    await within(dialog).findByRole('region', { name: 'What it places' });
    const named = within(dialog).getByRole('textbox', { name: 'New section title' });
    await userEvent.clear(named);
    await userEvent.type(named, 'Upkeep');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Place' }));

    expect(await within(dialog).findByText(/Something changed since the report/)).toBeVisible();
    await within(dialog).findByRole('region', { name: 'What it places' });
    expect(named).toHaveValue('Upkeep');
    const reports = asked.filter(
      (each) => each.method === 'GET' && each.path.endsWith('/placement'),
    );
    expect(reports.length).toBe(2);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Place' }));
    expect(placed).toHaveBeenCalledOnce();
  });
});
