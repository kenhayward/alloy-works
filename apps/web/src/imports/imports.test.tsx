import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ImportFile } from './ImportFile.js';
import { ImportPage } from './ImportPage.js';

const GENERAL = '11111111-1111-4111-8111-111111111111';
const IMPORT = '22222222-2222-4222-8222-222222222222';
const DOCUMENT = '33333333-3333-4333-8333-333333333333';
const SECTION = '44444444-4444-4444-8444-444444444444';
const INTRODUCTION = '55555555-5555-4555-8555-555555555555';
const SAMPLING = '66666666-6666-4666-8666-666666666666';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const base = {
  id: IMPORT,
  space: GENERAL,
  importer: GENERAL,
  fileName: 'Pond survey.docx',
  fileType: 'docx',
  failure: null,
  document: null,
  createdAt: '2026-10-22T09:00:00.000Z',
  sweepsAt: '2026-11-21T09:00:00.000Z',
  levels: { section: 1, component: 2 },
  title: 'Pond survey by Ada',
  revision: 0,
  place: null,
  accepted: null,
};

const proposed = {
  ...base,
  state: 'proposed',
  parts: [
    {
      id: INTRODUCTION,
      kind: 'component',
      title: 'Introduction',
      parent: null,
      reason: { rule: 'beforeFirstHeading' },
      flags: [],
      blocks: 1,
      source: 'Some opening words.',
    },
    {
      id: SECTION,
      kind: 'section',
      title: 'Methods',
      parent: null,
      reason: { rule: 'heading', style: 'Heading 1', text: 'Methods', level: 1 },
      flags: [],
      blocks: 0,
      source: 'Methods',
    },
    {
      id: SAMPLING,
      kind: 'component',
      title: 'Sampling',
      parent: SECTION,
      reason: { rule: 'heading', style: 'Heading 2', text: 'Sampling', level: 2 },
      flags: ['empty'],
      blocks: 0,
      source: 'Sampling',
    },
  ],
  report: [
    {
      stage: 'read',
      action: 'discarded',
      subject: 'notYetRead',
      message: 'Something the import does not read yet was left out.',
      detail: 'footnote',
      count: 2,
      part: null,
    },
    {
      stage: 'sanitise',
      action: 'discarded',
      subject: 'hyperlink',
      message:
        'A link was removed because its target is not a web or email address. Its text was kept.',
      part: 0,
    },
  ],
};

/** Each part as its own route answers it (IMP-028). */
const details: Record<string, unknown> = {
  [INTRODUCTION]: {
    ...proposed.parts[0],
    blocks: [
      { type: 'paragraph', text: 'Some opening words.' },
      { type: 'paragraph', text: 'Ada counted newts.' },
    ],
    source: 'Some opening words.\nAda counted newts.',
    place: 0,
    of: 3,
    previous: null,
    next: SECTION,
  },
  [SECTION]: {
    ...proposed.parts[1],
    blocks: [],
    place: 1,
    of: 3,
    previous: INTRODUCTION,
    next: SAMPLING,
  },
  [SAMPLING]: { ...proposed.parts[2], blocks: [], place: 2, of: 3, previous: SECTION, next: null },
};

interface Asked {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

function service(
  views: readonly unknown[] = [proposed],
  edited: (body: unknown) => Response = () => json(200, { ...proposed, revision: 1 }),
) {
  const asked: Asked[] = [];
  let read = 0;
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const path = url.pathname;
    const bytes =
      request.headers.get('content-type') === 'application/octet-stream'
        ? new Uint8Array(await request.arrayBuffer())
        : undefined;
    const text = bytes === undefined ? await request.text() : '';
    asked.push({
      method: request.method,
      path,
      body: bytes ?? (text === '' ? undefined : (JSON.parse(text) as unknown)),
    });
    if (path === '/v1/spaces') {
      return json(200, {
        items: [{ id: GENERAL, name: 'General', archived: false, mayCreate: true }],
        next: null,
      });
    }
    if (request.method === 'POST' && path === `/v1/spaces/${GENERAL}/imports`) {
      return json(200, { ...base, state: 'awaiting', parts: [], report: [] });
    }
    if (request.method === 'PUT' && path === `/v1/imports/${IMPORT}/file`) {
      return json(200, { ...base, state: 'reading', parts: [], report: [] });
    }
    if (request.method === 'GET' && path === `/v1/imports/${IMPORT}`) {
      const view = views[Math.min(read, views.length - 1)];
      read += 1;
      return json(200, view);
    }
    const part = /^\/v1\/imports\/[0-9a-f-]+\/parts\/([0-9a-f-]+)$/.exec(path)?.[1];
    if (request.method === 'GET' && part !== undefined && details[part]) {
      return json(200, details[part]);
    }
    if (request.method === 'GET' && path === `/v1/imports/${IMPORT}/parts`) {
      const q = url.searchParams.get('q');
      const flag = url.searchParams.get('flag');
      return json(200, {
        parts: flag === 'empty' ? [SAMPLING] : q === 'newts' ? [INTRODUCTION] : [],
      });
    }
    if (request.method === 'PUT' && path === `/v1/imports/${IMPORT}/place`) {
      return json(200, proposed);
    }
    if (request.method === 'POST' && path === `/v1/imports/${IMPORT}/edits`) {
      return edited(asked.at(-1)?.body);
    }
    if (request.method === 'POST' && path === `/v1/imports/${IMPORT}/accept`) {
      return json(200, {
        import: { ...proposed, state: 'accepted', document: DOCUMENT, sweepsAt: null },
        document: DOCUMENT,
      });
    }
    if (request.method === 'POST' && path === `/v1/imports/${IMPORT}/abandon`) {
      return json(200, { ...base, state: 'abandoned', sweepsAt: null, parts: [], report: [] });
    }
    if (request.method === 'PUT' && path === `/v1/imports/${IMPORT}/levels`) {
      return json(200, { ...base, state: 'reading', parts: [], report: [] });
    }
    return json(404, { code: 'not_found', message: 'Not found' });
  });
  return { client: createApiClient({ baseUrl: 'http://imports.test', fetch: fetching }), asked };
}

afterEach(() => {
  window.location.hash = '';
});

describe('importing a file', () => {
  it('makes an import in the chosen space, sends the file as its bytes, and opens its page', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<ImportFile client={client} />);
    await screen.findByRole('option', { name: 'General' });
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'Pond survey.docx');
    await user.upload(screen.getByLabelText('File'), file);
    await user.click(screen.getByRole('button', { name: 'Import file' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/imports/${IMPORT}`));
    expect(asked.find((each) => each.method === 'POST')?.body).toEqual({
      fileName: 'Pond survey.docx',
      fileType: 'docx',
    });
    expect(asked.find((each) => each.method === 'PUT')?.body).toEqual(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    );
  });

  it('refuses a file whose name says it is none it takes, sending nothing', async () => {
    // Past the chooser's own filter, as a drop or another browser's chooser would be.
    const user = userEvent.setup({ applyAccept: false });
    const { client, asked } = service();
    render(<ImportFile client={client} />);
    await screen.findByRole('option', { name: 'General' });
    await user.upload(screen.getByLabelText('File'), new File(['Ada'], 'Pond survey.pdf'));
    await user.click(screen.getByRole('button', { name: 'Import file' }));
    expect(
      await screen.findByText(
        'Choose a Word document (.docx), Markdown (.md) or HTML (.html) file.',
      ),
    ).toBeInTheDocument();
    expect(asked.some((each) => each.method === 'POST')).toBe(false);
  });
});

describe("an import's page", () => {
  it('IMP-004 IMP-007 shows the outline proposed, each part with its reason, and what was left out', async () => {
    const { client } = service();
    render(<ImportPage client={client} id={IMPORT} />);
    const outline = await screen.findByRole('list', { name: 'Proposed outline' });
    expect(within(outline).getByRole('button', { name: 'Section: Methods' })).toBeInTheDocument();
    expect(
      within(outline).getByRole('button', { name: 'Component: Sampling' }),
    ).toBeInTheDocument();
    expect(within(outline).getByText('Nothing stands under it.')).toBeInTheDocument();
    const part = await screen.findByRole('region', { name: 'Part 1 of 3: Introduction' });
    expect(within(part).getByText('What stands before the first heading.')).toBeInTheDocument();
    const report = screen.getByRole('list', { name: 'Report' });
    expect(report).toHaveTextContent(
      'Footnotes: Something the import does not read yet was left out. (2)',
    );
    expect(report).toHaveTextContent('Introduction: A link was removed');
  });

  it('follows the file while it is read, then shows what it proposes', async () => {
    const { client } = service([{ ...base, state: 'reading', parts: [], report: [] }, proposed]);
    render(<ImportPage client={client} id={IMPORT} wait={0} />);
    expect(await screen.findByText('Reading the file.')).toBeInTheDocument();
    expect(await screen.findByRole('list', { name: 'Proposed outline' })).toBeInTheDocument();
  });

  it('accepts the proposal under the title given, and opens the document it made', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<ImportPage client={client} id={IMPORT} />);
    const title = await screen.findByRole('textbox', { name: 'Document title' });
    expect(title).toHaveValue('Pond survey by Ada');
    await user.clear(title);
    await user.type(title, 'Pond survey');
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/documents/${DOCUMENT}`));
    expect(asked.find((each) => each.path.endsWith('/accept'))?.body).toEqual({
      title: 'Pond survey',
    });
  });

  it('IMP-008 abandons the import, saying nothing of it was kept', async () => {
    const user = userEvent.setup();
    const { client } = service();
    render(<ImportPage client={client} id={IMPORT} />);
    await user.click(await screen.findByRole('button', { name: 'Abandon' }));
    expect(await screen.findByText('Abandoned. Nothing of it was kept.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });

  it('IMP-004 proposes again at the levels chosen', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<ImportPage client={client} id={IMPORT} />);
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Components at heading level' }),
      '3',
    );
    await user.click(screen.getByRole('button', { name: 'Propose again' }));
    await waitFor(() =>
      expect(asked.find((each) => each.path.endsWith('/levels'))?.body).toEqual({
        section: 1,
        component: 3,
      }),
    );
  });

  it('IMP-028 shows one part at a time beside the text it came from, with next and previous', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<ImportPage client={client} id={IMPORT} />);
    const part = await screen.findByRole('region', { name: 'Part 1 of 3: Introduction' });
    const holds = within(part).getByRole('list', { name: 'What it holds' });
    expect(within(holds).getByText('Ada counted newts.')).toBeInTheDocument();
    expect(within(part).getByLabelText('From the file')).toHaveTextContent(
      'Some opening words. Ada counted newts.',
    );
    expect(within(part).getByRole('button', { name: 'Previous part' })).toBeDisabled();
    await user.click(within(part).getByRole('button', { name: 'Next part' }));
    expect(await screen.findByRole('region', { name: 'Part 2 of 3: Methods' })).toBeInTheDocument();
    await waitFor(() =>
      expect(asked.find((each) => each.path.endsWith('/place'))?.body).toEqual({ part: SECTION }),
    );
  });

  it('IMP-029 returns to the part its importer was last at', async () => {
    const { client } = service([{ ...proposed, place: SAMPLING }]);
    render(<ImportPage client={client} id={IMPORT} />);
    expect(
      await screen.findByRole('region', { name: 'Part 3 of 3: Sampling' }),
    ).toBeInTheDocument();
  });

  it('IMP-029 searches the parts by their text, and filters them by what they are flagged for', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<ImportPage client={client} id={IMPORT} />);
    await user.type(await screen.findByRole('searchbox', { name: 'Search parts' }), 'newts');
    await user.click(screen.getByRole('button', { name: 'Find' }));
    const outline = screen.getByRole('list', { name: 'Proposed outline' });
    await waitFor(() =>
      expect(within(outline).queryByRole('button', { name: 'Section: Methods' })).toBeNull(),
    );
    expect(
      within(outline).getByRole('button', { name: 'Component: Introduction' }),
    ).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Search parts' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Show' }), 'empty');
    await user.click(screen.getByRole('button', { name: 'Find' }));
    await waitFor(() =>
      expect(within(outline).queryByRole('button', { name: 'Component: Introduction' })).toBeNull(),
    );
    expect(
      within(outline).getByRole('button', { name: 'Component: Sampling' }),
    ).toBeInTheDocument();
    expect(asked.some((each) => each.path === `/v1/imports/${IMPORT}/parts`)).toBe(true);
  });

  it('IMP-002 IMP-041 renames, splits and merges a part against the revision read, saying why an edit is refused', async () => {
    const user = userEvent.setup();
    const { client, asked } = service([proposed], (body) =>
      (body as { edit: { edit: string } }).edit.edit === 'merge'
        ? json(400, {
            code: 'import_edit_refused',
            message: 'Only two components, or two sections, can be merged.',
          })
        : json(200, { ...proposed, revision: 1 }),
    );
    render(<ImportPage client={client} id={IMPORT} />);
    const part = await screen.findByRole('region', { name: 'Part 1 of 3: Introduction' });
    const title = within(part).getByRole('textbox', { name: 'Part title' });
    await user.clear(title);
    await user.type(title, 'Preface');
    await user.click(within(part).getByRole('button', { name: 'Rename' }));
    await waitFor(() =>
      expect(asked.filter((each) => each.path.endsWith('/edits')).map((each) => each.body)).toEqual(
        [{ revision: 0, edit: { edit: 'rename', part: INTRODUCTION, title: 'Preface' } }],
      ),
    );
    await user.click(within(part).getByRole('button', { name: 'Split before block 2' }));
    await waitFor(() =>
      expect(asked.filter((each) => each.path.endsWith('/edits')).at(-1)?.body).toEqual({
        revision: 1,
        edit: { edit: 'split', part: INTRODUCTION, at: 1, title: 'Ada counted newts.' },
      }),
    );
    await user.click(within(part).getByRole('button', { name: 'Merge with the next part' }));
    expect(
      await screen.findByText('Only two components, or two sections, can be merged.'),
    ).toBeInTheDocument();
  });

  it('IMP-031 shows on the accepted import how much was accepted unchanged', async () => {
    const { client } = service([
      {
        ...proposed,
        state: 'accepted',
        document: DOCUMENT,
        sweepsAt: null,
        accepted: { unchanged: 2, edited: 0, merged: 0, split: 0, renamed: 1 },
      },
    ]);
    render(<ImportPage client={client} id={IMPORT} />);
    const counts = await screen.findByRole('list', { name: 'What was accepted' });
    expect(counts).toHaveTextContent('2 parts accepted unchanged');
    expect(counts).toHaveTextContent('1 part renamed');
    expect(counts).toHaveTextContent('0 parts merged');
  });
});
