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
};

const proposed = {
  ...base,
  state: 'proposed',
  parts: [
    {
      id: '55555555-5555-4555-8555-555555555555',
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
      id: '66666666-6666-4666-8666-666666666666',
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

interface Asked {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

function service(views: readonly unknown[] = [proposed]) {
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
    expect(within(outline).getByText('Section: Methods')).toBeInTheDocument();
    expect(
      within(outline).getByText('Heading 1 “Methods” starts this section.'),
    ).toBeInTheDocument();
    expect(within(outline).getByText('Component: Sampling')).toBeInTheDocument();
    expect(within(outline).getByText('Nothing stands under it.')).toBeInTheDocument();
    expect(within(outline).getByText('What stands before the first heading.')).toBeInTheDocument();
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
});
