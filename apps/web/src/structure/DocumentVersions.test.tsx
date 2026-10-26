import { createApiClient } from '@alloy-works/api-client';
import {
  compareOutlines,
  OUTLINE_SCHEMA_VERSION,
  type OutlineDocument,
  type OutlineNode,
} from '@alloy-works/domain';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DocumentVersions } from './DocumentVersions.js';

const DOCUMENT = 'dddddddd-0000-4000-8000-000000000001';
const V2 = 'dddddddd-0000-4000-8000-000000000002';
const V3 = 'dddddddd-0000-4000-8000-000000000003';
const V4 = 'dddddddd-0000-4000-8000-000000000004';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const section = (key: string, words: string): OutlineNode => ({
  id: key.repeat(26),
  type: 'section',
  title: [{ type: 'text', value: words, marks: [] }],
  numbered: true,
  matter: 'body',
  pageBreak: 'none',
  values: {},
  children: [],
});
const outline = (nodes: OutlineNode[]): OutlineDocument => ({
  schemaVersion: OUTLINE_SCHEMA_VERSION,
  title: 'The dosing report',
  language: 'en-GB',
  direction: 'ltr',
  nodes,
});
const listed = (
  id: string,
  number: string,
  restoredFrom: { id: string; number: string } | null,
) => ({
  id,
  number,
  createdAt: '2026-10-11T12:00:00.000Z',
  author: { id: 'a', name: 'Ada' },
  note: null,
  restoredFrom,
});
const summary = (id: string, number: string) => ({
  id,
  number,
  author: 'a',
  createdAt: '2026-10-11T12:00:00.000Z',
  note: null,
});

const reference = (key: string): OutlineNode => ({
  id: key.repeat(26),
  type: 'reference',
  component: 'cccccccc-0000-4000-8000-000000000001',
  mode: { kind: 'latest' },
  numbered: true,
  matter: 'body',
  pageBreak: 'none',
  values: {},
  children: [],
});

/**
 * A document at 0.3 over 0.2, whose restore of 0.2 brings Method back, previewed then made: the
 * preview made against `latest`, its outlines and titles as given, the restore answered `answer`.
 */
function service(
  refusals: readonly unknown[] = [],
  over: {
    readonly latest?: ReturnType<typeof summary>;
    readonly older?: OutlineDocument;
    readonly newer?: OutlineDocument;
    readonly titles?: unknown;
    readonly answer?: () => Response;
  } = {},
) {
  const asked: string[] = [];
  const sent: unknown[] = [];
  let restored = false;
  const older = over.older ?? outline([section('a', 'Introduction')]);
  const newer = over.newer ?? outline([section('a', 'Introduction'), section('b', 'Method')]);
  const fetching = vi.fn(async (input: Request) => {
    const url = new URL(input.url);
    asked.push(`${input.method} ${url.pathname}`);
    if (url.pathname.endsWith('/versions')) {
      return json(200, {
        items: [
          ...(restored ? [listed(V4, '0.4', { id: V2, number: '0.2' })] : []),
          listed(V3, '0.3', null),
          listed(V2, '0.2', null),
        ],
        next: null,
      });
    }
    if (url.pathname.endsWith('/restoration')) {
      return json(200, {
        document: DOCUMENT,
        from: summary(V2, '0.2'),
        latest: over.latest ?? summary(V3, '0.3'),
        older,
        newer,
        structure: compareOutlines(older, newer).changes,
        titles: over.titles ?? { older: [], newer: [] },
        refusals,
      });
    }
    sent.push(await input.json());
    if (over.answer) return over.answer();
    restored = true;
    return json(200, { version: summary(V4, '0.4') });
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://acme.test', fetch: fetching }), asked, sent };
}

describe("a document's Versions panel", () => {
  it('SCH-058 opens each earlier version on its own page, read only', async () => {
    const { client } = service();
    render(<DocumentVersions client={client} id={DOCUMENT} mayEdit={false} />);
    const list = await screen.findByRole('list', { name: 'Versions' });
    expect(within(list).getByRole('link', { name: 'Open 0.2' })).toHaveAttribute(
      'href',
      `#/documents/${DOCUMENT}/versions/${V2}`,
    );
    expect(within(list).queryByRole('link', { name: 'Open 0.3' })).toBeNull();
  });

  it('VER-035 VER-033 previews what restoring an earlier version would change in the outline, then restores it', async () => {
    const { client, asked, sent } = service();
    const onRestored = vi.fn();
    render(<DocumentVersions client={client} id={DOCUMENT} mayEdit onRestored={onRestored} />);
    const list = await screen.findByRole('list', { name: 'Versions' });
    expect(within(list).queryByRole('button', { name: 'Restore 0.3' })).toBeNull();
    await userEvent.click(within(list).getByRole('button', { name: 'Restore 0.2' }));
    const preview = await screen.findByRole('region', { name: 'Restore 0.2' });
    const changes = await within(preview).findByRole('list', {
      name: 'What restoring 0.2 would change',
    });
    expect(changes.querySelector('ins')).toHaveTextContent('Method');
    expect(asked).not.toContain(`POST /v1/documents/${DOCUMENT}/versions/${V2}/restore`);
    await userEvent.click(within(preview).getByRole('button', { name: 'Restore this version' }));
    expect(await screen.findByText('Restored as version 0.4.')).toBeInTheDocument();
    expect(sent).toEqual([{ latest: V3 }]);
    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Restored from version 0.2')).toBeInTheDocument();
  });

  it("says in words, by its code, why the outline's guards refuse a restore, and offers none", async () => {
    const { client } = service([
      { code: 'outline_invalid', why: 'sections_added', reason: 'In English' },
    ]);
    render(<DocumentVersions client={client} id={DOCUMENT} mayEdit />);
    const list = await screen.findByRole('list', { name: 'Versions' });
    await userEvent.click(within(list).getByRole('button', { name: 'Restore 0.2' }));
    const preview = await screen.findByRole('region', { name: 'Restore 0.2' });
    expect(
      await within(preview).findByText(
        "This document's template does not allow sections to be added, so this version cannot be restored.",
      ),
    ).toBeInTheDocument();
    expect(within(preview).queryByRole('button', { name: 'Restore this version' })).toBeNull();
  });

  it('VER-044 names each component since deleted that a restore would reference, and offers none', async () => {
    const { client } = service([
      { code: 'reference_deleted', node: 'b'.repeat(26), title: 'Install the printer' },
      { code: 'reference_deleted', node: 'c'.repeat(26), title: 'Clean the nozzle' },
    ]);
    render(<DocumentVersions client={client} id={DOCUMENT} mayEdit />);
    const list = await screen.findByRole('list', { name: 'Versions' });
    await userEvent.click(within(list).getByRole('button', { name: 'Restore 0.2' }));
    const preview = await screen.findByRole('region', { name: 'Restore 0.2' });
    for (const title of ['Install the printer', 'Clean the nozzle']) {
      expect(
        await within(preview).findByText(
          `${title} has been deleted, so this version cannot be restored.`,
        ),
      ).toBeInTheDocument();
    }
    expect(within(preview).queryByRole('button', { name: 'Restore this version' })).toBeNull();
  });

  it('posts and shows the latest the preview was made against, not the list head (the RS final review)', async () => {
    const V5 = 'dddddddd-0000-4000-8000-000000000005';
    const { client, sent } = service([], { latest: summary(V5, '0.5') });
    render(<DocumentVersions client={client} id={DOCUMENT} mayEdit />);
    const list = await screen.findByRole('list', { name: 'Versions' });
    await userEvent.click(within(list).getByRole('button', { name: 'Restore 0.2' }));
    const preview = await screen.findByRole('region', { name: 'Restore 0.2' });
    expect(
      await within(preview).findByText(/^A new version after 0\.5, with the outline 0\.2 had\./),
    ).toBeInTheDocument();
    await userEvent.click(within(preview).getByRole('button', { name: 'Restore this version' }));
    expect(sent).toEqual([{ latest: V5 }]);
  });

  it('reads the versions again when the latest has moved on since the preview, and when the outline changes', async () => {
    const { client, asked } = service([], {
      answer: () =>
        json(409, {
          code: 'version_precondition',
          message: 'This document has a newer version.',
          current: summary(V4, '0.4'),
        }),
    });
    const lists = () => asked.filter((each) => each.endsWith(`${DOCUMENT}/versions`)).length;
    const { rerender } = render(
      <DocumentVersions client={client} id={DOCUMENT} mayEdit latest={V3} />,
    );
    const list = await screen.findByRole('list', { name: 'Versions' });
    expect(lists()).toBe(1);
    await userEvent.click(within(list).getByRole('button', { name: 'Restore 0.2' }));
    const preview = await screen.findByRole('region', { name: 'Restore 0.2' });
    await userEvent.click(within(preview).getByRole('button', { name: 'Restore this version' }));
    expect(
      await screen.findByText(
        'A newer version was saved since this was shown. Look at it again before restoring.',
      ),
    ).toBeInTheDocument();
    await vi.waitFor(() => expect(lists()).toBe(2));
    // The page shows a newer version, made by an outline act.
    rerender(<DocumentVersions client={client} id={DOCUMENT} mayEdit latest={V4} />);
    await vi.waitFor(() => expect(lists()).toBe(3));
  });

  it('restores once however often Restore this version is pressed, saying so in a live region there from the start', async () => {
    const { client, sent } = service();
    render(<DocumentVersions client={client} id={DOCUMENT} mayEdit />);
    const list = await screen.findByRole('list', { name: 'Versions' });
    await userEvent.click(within(list).getByRole('button', { name: 'Restore 0.2' }));
    const preview = await screen.findByRole('region', { name: 'Restore 0.2' });
    const status = within(preview).getByRole('status');
    expect(status).toBeEmptyDOMElement();
    const button = await within(preview).findByRole('button', { name: 'Restore this version' });
    await userEvent.dblClick(button);
    expect(await within(status).findByText('Restored as version 0.4.')).toBeInTheDocument();
    expect(sent).toEqual([{ latest: V3 }]);
  });

  it("names a reference by its own side's title: one the restore removes by the latest's", async () => {
    const node = 'r'.repeat(26);
    const { client } = service([], {
      older: outline([section('a', 'Introduction'), reference('r')]),
      newer: outline([section('a', 'Introduction')]),
      titles: { older: [{ node, title: 'Install the new printer' }], newer: [] },
    });
    render(<DocumentVersions client={client} id={DOCUMENT} mayEdit />);
    const list = await screen.findByRole('list', { name: 'Versions' });
    await userEvent.click(within(list).getByRole('button', { name: 'Restore 0.2' }));
    const changes = await screen.findByRole('list', { name: 'What restoring 0.2 would change' });
    expect(changes.querySelector('del')).toHaveTextContent('Install the new printer');
  });

  it('lists the versions to a reader who may not edit, offering no restore', async () => {
    const { client } = service();
    render(<DocumentVersions client={client} id={DOCUMENT} mayEdit={false} />);
    const list = await screen.findByRole('list', { name: 'Versions' });
    expect(within(list).getByText('0.2')).toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: 'Restore 0.2' })).toBeNull();
  });
});
