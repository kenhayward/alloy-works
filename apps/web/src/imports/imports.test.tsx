import { createApiClient } from '@alloy-works/api-client';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ImportFile } from './ImportFile.js';
import { ImportHelp } from './ImportHelp.js';
import { ImportPage } from './ImportPage.js';

const GENERAL = '11111111-1111-4111-8111-111111111111';
const IMPORT = '22222222-2222-4222-8222-222222222222';
const DOCUMENT = '33333333-3333-4333-8333-333333333333';
const SECTION = '44444444-4444-4444-8444-444444444444';
const INTRODUCTION = '55555555-5555-4555-8555-555555555555';
const SAMPLING = '66666666-6666-4666-8666-666666666666';
const EARLIER = '77777777-7777-4777-8777-777777777777';
const MADE_SAMPLING = '88888888-8888-4888-8888-888888888888';
const MADE_RESULTS = '99999999-9999-4999-8999-999999999999';

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
  references: [],
  identities: [],
  policy: 'map',
  policyApplied: false,
  kind: 'first',
  earlier: null,
  recognised: null,
  earlierMade: [],
  gone: [],
  outcome: null,
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
  answered: Record<string, unknown> = details,
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
    if (request.method === 'GET' && part !== undefined && answered[part]) {
      return json(200, answered[part]);
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
    if (request.method === 'PUT' && path === `/v1/imports/${IMPORT}/kind`) {
      return json(200, { ...(views.at(-1) as object), kind: 'again', earlier: EARLIER });
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
      revision: 0,
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
        revision: 0,
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

describe("an import's structure in review (IMc)", () => {
  const ADA = '77777777-7777-4777-8777-777777777777';
  const structured = {
    ...proposed,
    references: [{ key: 'wx-1', field: 'REF', text: 'Section 9', resolved: null }],
    identities: [
      {
        name: 'Ada',
        email: 'ada@example.com',
        carries: ['changes'],
        match: 'email',
        member: ADA,
        memberName: 'Ada Lovelace',
        confirmed: false,
      },
      {
        name: 'Grace',
        email: null,
        carries: ['comments'],
        match: 'name',
        member: GENERAL,
        memberName: 'Grace Moss',
        confirmed: false,
      },
      {
        name: 'Edsger',
        email: null,
        carries: ['comments'],
        match: 'none',
        member: null,
        memberName: null,
        confirmed: false,
      },
    ],
  };
  const parts = {
    ...details,
    [INTRODUCTION]: {
      ...(details[INTRODUCTION] as object),
      blocks: [
        { id: 'b1', type: 'paragraph', text: 'Some opening words.' },
        { id: 'b2', type: 'paragraph', text: 'Ada counted newts.' },
      ],
      suggestions: [{ author: 'Ada', blocks: 1, text: 'Some opening words, quickly.' }],
      threads: [
        {
          author: 'Grace',
          text: 'Check this count.',
          quote: 'counted newts',
          clamped: true,
          replies: [{ author: 'Edsger', text: 'Recounted.' }],
        },
      ],
      references: ['wx-1'],
    },
  };

  it("IMP-005 IMP-032 shows each part's suggestions and threads by their Word author, as the file carries them", async () => {
    const { client } = service([structured], undefined, parts);
    render(<ImportPage client={client} id={IMPORT} />);
    const suggestions = await screen.findByRole('list', { name: 'Suggestions it will make' });
    expect(suggestions).toHaveTextContent('Ada (from Word), 1 block: Some opening words, quickly.');
    const threads = screen.getByRole('list', { name: 'Threads it will make' });
    expect(threads).toHaveTextContent('Grace (from Word) on “counted newts”: Check this count.');
    expect(threads).toHaveTextContent('Edsger (from Word): Recounted.');
    expect(threads).toHaveTextContent('anchored where it starts');
  });

  it('IMP-009 IMP-010 lists the names the file carries with the member each matches, as attribution only, and confirms a name match', async () => {
    const user = userEvent.setup();
    const { client, asked } = service(
      [structured],
      () => json(200, { ...structured, revision: 1 }),
      parts,
    );
    render(<ImportPage client={client} id={IMPORT} />);
    const names = await screen.findByRole('list', { name: 'Names the file carries' });
    expect(names).toHaveTextContent(
      'Ada (ada@example.com), tracked changes: matched to Ada Lovelace by email',
    );
    expect(names).toHaveTextContent('Edsger, comments: kept as text');
    expect(screen.getByText(/never made by them/)).toBeInTheDocument();
    await user.click(within(names).getByRole('button', { name: 'Confirm Grace is Grace Moss' }));
    await waitFor(() =>
      expect(asked.filter((each) => each.path.endsWith('/edits')).map((each) => each.body)).toEqual(
        [{ revision: 0, edit: { edit: 'identity', identity: 'Grace', member: GENERAL } }],
      ),
    );
  });

  it('IMP-033 IMP-034 lists each reference outside the import with the text it showed, and points it at a block or makes it text', async () => {
    const user = userEvent.setup();
    const { client, asked } = service(
      [structured],
      () => json(200, { ...structured, revision: 1 }),
      parts,
    );
    render(<ImportPage client={client} id={IMPORT} />);
    const outside = await screen.findByRole('list', { name: 'References outside the import' });
    expect(outside).toHaveTextContent('“Section 9”: not resolved yet');
    const part = await screen.findByRole('region', { name: 'Part 1 of 3: Introduction' });
    await user.selectOptions(
      within(part).getByRole('combobox', { name: 'Point “Section 9” at' }),
      'b2',
    );
    await user.click(within(part).getByRole('button', { name: 'Point it there' }));
    await user.click(within(part).getByRole('button', { name: 'Make “Section 9” plain text' }));
    await waitFor(() =>
      expect(asked.filter((each) => each.path.endsWith('/edits')).map((each) => each.body)).toEqual(
        [
          {
            revision: 0,
            edit: { edit: 'reference', reference: 'wx-1', to: { kind: 'block', block: 'b2' } },
          },
          { revision: 1, edit: { edit: 'reference', reference: 'wx-1', to: { kind: 'text' } } },
        ],
      ),
    );
  });

  it('IMP-011 says which identity policy was applied once accepted', async () => {
    const { client } = service([
      { ...structured, state: 'accepted', document: DOCUMENT, sweepsAt: null, policyApplied: true },
    ]);
    render(<ImportPage client={client} id={IMPORT} />);
    expect(
      await screen.findByText(
        'Names were matched to members, as attribution, when it was accepted.',
      ),
    ).toBeInTheDocument();
  });
});

describe('importing a file again (IMd)', () => {
  const recognised = {
    import: EARLIER,
    match: 'name',
    fileName: 'Pond survey.docx',
    importer: GENERAL,
    importerName: 'Grace Moss',
    at: '2026-10-20T09:00:00.000Z',
    document: DOCUMENT,
    documentTitle: 'Pond survey',
  };
  const again = {
    ...proposed,
    kind: 'again',
    earlier: EARLIER,
    recognised,
    earlierMade: [
      { component: MADE_SAMPLING, title: 'Sampling' },
      { component: MADE_RESULTS, title: 'Results' },
    ],
    gone: [{ component: MADE_RESULTS, title: 'Results' }],
    parts: [
      {
        ...proposed.parts[0],
        again: { status: 'new', component: null, componentTitle: null, by: null },
      },
      { ...proposed.parts[1], again: null },
      {
        ...proposed.parts[2],
        again: {
          status: 'changed',
          component: MADE_SAMPLING,
          componentTitle: 'Sampling',
          by: 'provenance',
        },
      },
    ],
  };
  const againDetails = {
    ...details,
    [INTRODUCTION]: {
      ...(details[INTRODUCTION] as object),
      again: again.parts[0]!.again,
      diff: null,
    },
    [SAMPLING]: {
      ...(details[SAMPLING] as object),
      again: again.parts[2]!.again,
      diff: [
        { change: 'removed', text: 'Grace counted newts twice.' },
        { change: 'added', text: 'Ada counted newts.' },
      ],
    },
  };

  it('IMP-036 says first that the file was imported before, by whom, when and into what, and offers to update what it made', async () => {
    const user = userEvent.setup();
    const { client, asked } = service([{ ...proposed, recognised }]);
    render(<ImportPage client={client} id={IMPORT} />);
    const banner = await screen.findByRole('region', { name: 'Imported before' });
    expect(banner).toHaveTextContent(
      'A file named Pond survey.docx was imported into this space before, by Grace Moss',
    );
    expect(within(banner).getByRole('link', { name: 'Pond survey' })).toHaveAttribute(
      'href',
      `#/documents/${DOCUMENT}`,
    );
    // It stands before the outline.
    expect(
      banner.compareDocumentPosition(screen.getByRole('list', { name: 'Proposed outline' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(banner).getByRole('button', { name: 'Import as new' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(banner).getByRole('button', { name: 'Update what it made' }));
    await waitFor(() =>
      expect(asked.find((each) => each.path.endsWith('/kind'))?.body).toEqual({
        revision: 0,
        kind: 'again',
        earlier: EARLIER,
      }),
    );
  });

  it('IMP-036 IMP-037 shows each part as unchanged, changed or new, what changed against the space, and lets a part be matched again', async () => {
    const user = userEvent.setup();
    const { client, asked } = service(
      [again],
      () => json(200, { ...again, revision: 1 }),
      againDetails,
    );
    render(<ImportPage client={client} id={IMPORT} />);
    const outline = await screen.findByRole('list', { name: 'Proposed outline' });
    expect(outline).toHaveTextContent('New: made and placed in Pond survey when accepted.');
    expect(outline).toHaveTextContent('Changed: suggested on Sampling when accepted.');
    expect(screen.getByRole('list', { name: 'Gone from the file' })).toHaveTextContent(
      'Results: kept, and flagged on the document',
    );

    await user.click(within(outline).getByRole('button', { name: 'Component: Sampling' }));
    const part = await screen.findByRole('region', { name: 'Part 3 of 3: Sampling' });
    const diff = within(part).getByRole('list', {
      name: 'What changed against Sampling as it is now',
    });
    expect(within(diff).getByText('Grace counted newts twice.').closest('del')).not.toBeNull();
    expect(within(diff).getByText('Ada counted newts.').closest('ins')).not.toBeNull();

    await user.selectOptions(
      within(part).getByRole('combobox', { name: 'Matched to' }),
      MADE_RESULTS,
    );
    await user.click(within(part).getByRole('button', { name: 'Match it' }));
    await waitFor(() =>
      expect(asked.find((each) => each.path.endsWith('/edits'))?.body).toEqual({
        revision: 0,
        edit: { edit: 'match', part: SAMPLING, component: MADE_RESULTS },
      }),
    );
    await user.click(within(part).getByRole('button', { name: 'Mark it new' }));
    await waitFor(() =>
      expect(asked.filter((each) => each.path.endsWith('/edits')).at(-1)?.body).toMatchObject({
        edit: { edit: 'match', part: SAMPLING, component: null },
      }),
    );
  });
});

describe('what an import keeps (IMe)', () => {
  it("IMP-026 states on the import what this file's format keeps and what it does not, never as lossless", async () => {
    const { client } = service();
    render(<ImportPage client={client} id={IMPORT} />);
    const kept = await screen.findByRole('region', { name: 'What an import keeps' });
    expect(kept).toHaveTextContent(/headings, lists, tables, footnotes/);
    expect(kept).toHaveTextContent(/does not keep its appearance/);
    expect(kept).not.toHaveTextContent(/lossless/i);
    expect(
      within(kept).getByRole('link', { name: 'What arrives and what does not' }),
    ).toHaveAttribute('href', '#/help/import');
    cleanup();

    const markdown = service([{ ...proposed, fileName: 'Pond survey.md', fileType: 'markdown' }]);
    render(<ImportPage client={markdown.client} id={IMPORT} />);
    const said = await screen.findByRole('region', { name: 'What an import keeps' });
    expect(said).toHaveTextContent(/never fetched/);
    expect(said).not.toHaveTextContent(/tracked changes/);
  });

  it('IMP-026 lists in Help the Word structures that arrive and those that do not', () => {
    render(<ImportHelp />);
    const arrives = screen.getByRole('list', { name: 'What arrives from Word' });
    for (const each of [
      'Headings',
      'Lists',
      'Tables',
      'Footnotes',
      'Captions',
      'Figures',
      'Cross-references',
      'Tracked changes',
      'Comments',
    ]) {
      expect(within(arrives).getByText(new RegExp(`^${each}`))).toBeInTheDocument();
    }
    const not = screen.getByRole('list', { name: 'What does not arrive' });
    for (const each of [
      'Text boxes',
      'Content controls',
      'Equations',
      'Endnotes',
      'Page setup',
      'Macros and embedded objects',
      'File properties',
    ]) {
      expect(within(not).getByText(new RegExp(`^${each}`))).toBeInTheDocument();
    }
    expect(document.body).not.toHaveTextContent(/lossless/i);
  });
});
