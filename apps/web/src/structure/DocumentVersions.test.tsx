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

/** A document at 0.3 over 0.2, whose restore of 0.2 brings Method back, previewed then made. */
function service(refusals: readonly unknown[] = []) {
  const asked: string[] = [];
  const sent: unknown[] = [];
  let restored = false;
  const older = outline([section('a', 'Introduction')]);
  const newer = outline([section('a', 'Introduction'), section('b', 'Method')]);
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
        latest: summary(V3, '0.3'),
        older,
        newer,
        structure: compareOutlines(older, newer).changes,
        titles: [],
        refusals,
      });
    }
    sent.push(await input.json());
    restored = true;
    return json(200, { version: summary(V4, '0.4') });
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://acme.test', fetch: fetching }), asked, sent };
}

describe("a document's Versions panel", () => {
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

  it("says in words why the outline's guards refuse a restore, and offers none", async () => {
    const { client } = service([
      {
        code: 'outline_invalid',
        reason: "This document's template does not allow sections to be added",
      },
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

  it('lists the versions to a reader who may not edit, offering no restore', async () => {
    const { client } = service();
    render(<DocumentVersions client={client} id={DOCUMENT} mayEdit={false} />);
    const list = await screen.findByRole('list', { name: 'Versions' });
    expect(within(list).getByText('0.2')).toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: 'Restore 0.2' })).toBeNull();
  });
});
