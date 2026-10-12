import { createApiClient } from '@alloy-works/api-client';
import { compareContent, type ContentDocument } from '@alloy-works/domain';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { VersionsPanel } from './VersionsPanel.js';

const COMPONENT = 'cccccccc-0000-4000-8000-000000000001';
const V2 = 'cccccccc-0000-4000-8000-000000000002';
const V3 = 'cccccccc-0000-4000-8000-000000000003';

const docOf = (value: string): ContentDocument => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    { type: 'paragraph', id: 'p1', style: 'body', content: [{ type: 'text', value, marks: [] }] },
  ],
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function service() {
  const asked: string[] = [];
  const fetching = vi.fn(async (input: Request) => {
    const url = new URL(input.url);
    asked.push(`${url.pathname}${url.search}`);
    if (url.pathname.endsWith('/versions')) {
      return json(200, {
        items: [
          {
            id: V3,
            number: '0.3',
            createdAt: '2026-10-11T12:00:00.000Z',
            author: { id: 'a', name: 'Ada' },
            note: null,
          },
          {
            id: V2,
            number: '0.2',
            createdAt: '2026-10-10T12:00:00.000Z',
            author: { id: 'g', name: 'Grace' },
            note: null,
          },
        ],
        next: null,
      });
    }
    const older = docOf('Set the tray.');
    const newer = docOf('Set the new tray.');
    return json(200, {
      component: COMPONENT,
      from: { id: V2, number: '0.2' },
      to: { id: V3, number: '0.3' },
      older,
      newer,
      changes: compareContent(older, newer).changes,
    });
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://acme.test', fetch: fetching }), asked };
}

describe('the Versions panel', () => {
  it('CNT-111 CNT-112 lists each version with who cut it and when, and compares an earlier one with the latest as a redline', async () => {
    const { client, asked } = service();
    render(<VersionsPanel client={client} id={COMPONENT} />);
    const list = await screen.findByRole('list', { name: 'Versions' });
    expect(within(list).getByText(/Grace, 10 Oct/)).toBeInTheDocument();
    // The latest has nothing later to be compared with.
    expect(within(list).queryByRole('button', { name: 'Compare 0.3 with 0.3' })).toBeNull();
    await userEvent.click(within(list).getByRole('button', { name: 'Compare 0.2 with 0.3' }));
    const changes = await screen.findByRole('list', { name: 'Changes from 0.2 to 0.3' });
    expect(changes.querySelector('ins')).toHaveTextContent('Added: new');
    expect(asked).toContain(`/v1/components/${COMPONENT}/comparison?from=${V2}&to=${V3}`);
  });

  it('CNT-113 COL-026 shows my own changes since the version I opened, from what the editor holds now', async () => {
    const { client, asked } = service();
    render(
      <VersionsPanel
        client={client}
        id={COMPONENT}
        mine={() => ({ older: docOf('Set the tray.'), newer: docOf('Set the tray, then wait.') })}
      />,
    );
    await screen.findByRole('list', { name: 'Versions' });
    await userEvent.click(screen.getByRole('button', { name: 'My changes' }));
    const changes = screen.getByRole('list', { name: 'My changes' });
    expect(changes.querySelector('ins')).toHaveTextContent('Added: , then wait');
    // Compared in the browser: nothing asked of the service for it.
    expect(asked.some((each) => each.includes('/comparison'))).toBe(false);
  });

  it('CNT-113 says so where nothing is open for editing to compare', async () => {
    const { client, asked } = service();
    render(<VersionsPanel client={client} id={COMPONENT} mine={() => null} />);
    await screen.findByRole('list', { name: 'Versions' });
    await userEvent.click(screen.getByRole('button', { name: 'My changes' }));
    expect(screen.getByText('Nothing is open for editing to compare yet.')).toBeInTheDocument();
    expect(asked.some((each) => each.includes('/comparison'))).toBe(false);
  });
});

const V4 = 'cccccccc-0000-4000-8000-000000000005';
const REGION = 'cccccccc-0000-4000-8000-000000000006';

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

/** A component at 0.3 over 0.2, whose restore of 0.2 is previewed with `refusals` and then made. */
function restoring(refusals: readonly unknown[] = []) {
  const asked: string[] = [];
  const sent: unknown[] = [];
  let restored = false;
  const fetching = vi.fn(async (input: Request) => {
    const url = new URL(input.url);
    asked.push(`${input.method} ${url.pathname}${url.search}`);
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
        component: COMPONENT,
        from: summary(V2, '0.2'),
        latest: summary(V3, '0.3'),
        notCarried: [{ field: REGION, name: 'Region', value: 'EU' }],
        refusals,
      });
    }
    if (url.pathname.endsWith('/restore')) {
      sent.push(await input.json());
      restored = true;
      return json(200, { version: summary(V4, '0.4') });
    }
    const older = docOf('Set the new tray.');
    const newer = docOf('Set the tray.');
    return json(200, {
      component: COMPONENT,
      from: { id: V3, number: '0.3' },
      to: { id: V2, number: '0.2' },
      older,
      newer,
      changes: compareContent(older, newer).changes,
    });
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://acme.test', fetch: fetching }), asked, sent };
}

const editable = () => ({
  older: docOf('Set the new tray.'),
  newer: docOf('Set the new tray.'),
  mayEdit: true,
});

describe('restoring an earlier version from the Versions panel', () => {
  it('VER-035 previews a restore - the changes from the latest and the values not carried - then restores it', async () => {
    const { client, asked, sent } = restoring();
    const onRestored = vi.fn();
    render(
      <VersionsPanel client={client} id={COMPONENT} mine={editable} onRestored={onRestored} />,
    );
    const list = await screen.findByRole('list', { name: 'Versions' });
    // The latest is no earlier version to restore.
    expect(within(list).queryByRole('button', { name: 'Restore 0.3' })).toBeNull();
    await userEvent.click(within(list).getByRole('button', { name: 'Restore 0.2' }));
    const preview = await screen.findByRole('region', { name: 'Restore 0.2' });
    const changes = await screen.findByRole('list', { name: 'Changes from 0.3 to 0.2' });
    expect(changes.querySelector('del')).toHaveTextContent('Removed: new');
    expect(within(preview).getByText('Region: EU')).toBeInTheDocument();
    expect(asked).not.toContain(`POST /v1/components/${COMPONENT}/versions/${V2}/restore`);
    await userEvent.click(within(preview).getByRole('button', { name: 'Restore this version' }));
    expect(await screen.findByText('Restored as version 0.4.')).toBeInTheDocument();
    expect(sent).toEqual([{ latest: V3 }]);
    expect(onRestored).toHaveBeenCalledTimes(1);
    // VER-033: the history says what the new version came from.
    expect(await screen.findByText('Restored from version 0.2')).toBeInTheDocument();
  });

  it('says in words why a restore is refused, and offers no restore', async () => {
    const { client } = restoring([{ code: 'restore_locked', holder: { id: 'g', name: 'Grace' } }]);
    render(<VersionsPanel client={client} id={COMPONENT} mine={editable} />);
    const list = await screen.findByRole('list', { name: 'Versions' });
    await userEvent.click(within(list).getByRole('button', { name: 'Restore 0.2' }));
    const preview = await screen.findByRole('region', { name: 'Restore 0.2' });
    expect(
      await within(preview).findByText(
        'Grace is editing this component. It can be restored once they choose Done editing.',
      ),
    ).toBeInTheDocument();
    expect(within(preview).queryByRole('button', { name: 'Restore this version' })).toBeNull();
  });

  it('offers no restore to a reader who may not edit', async () => {
    const { client } = restoring();
    render(
      <VersionsPanel
        client={client}
        id={COMPONENT}
        mine={() => ({ ...editable(), mayEdit: false })}
      />,
    );
    const list = await screen.findByRole('list', { name: 'Versions' });
    expect(within(list).queryByRole('button', { name: 'Restore 0.2' })).toBeNull();
    expect(within(list).getByRole('button', { name: 'Compare 0.2 with 0.3' })).toBeInTheDocument();
  });
});
