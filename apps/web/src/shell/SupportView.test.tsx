import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Workspace } from '../editor/Workspace.js';
import { forgetSupportRead } from './SupportView.js';

const COMPONENT = '6a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const component = {
  id: COMPONENT,
  space: { id: 's1', name: 'Clinical' },
  version: {
    id: 'v1',
    number: '0.1',
    author: 'p1',
    createdAt: '2026-09-17T09:00:00.000Z',
    note: null,
  },
  content: {
    schemaVersion: 1,
    title: 'Dosing table',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      {
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: [{ type: 'text', value: 'Text.', marks: [] }],
      },
    ],
  },
  mayEdit: false,
  lock: null,
  type: { id: 'type-topic', name: 'Topic' },
  fields: [],
  schemas: [],
  values: {},
};

/** The service as a support person meets it, every request kept with the Support-Read it said. */
function service(scope: 'diagnostics' | 'metadata' | 'content') {
  const asked: { path: string; said: string | null }[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    asked.push({ path: url.pathname, said: request.headers.get('support-read') });
    if (url.pathname === '/v1/me') {
      return json(200, {
        id: 'p9',
        displayName: 'Sam',
        email: 'sam@vendor.example',
        environment: 'Production',
        support: {
          scope,
          spaces: scope === 'diagnostics' ? [] : [{ id: 's1', name: 'Clinical' }],
          purpose: 'Why the outline will not save',
          expiresAt: '2026-11-20T09:00:00.000Z',
        },
      });
    }
    if (url.pathname === `/v1/components/${COMPONENT}`) return json(200, component);
    return json(404, { code: 'not_found', message: 'none', traceId: 't' });
  }) as unknown as typeof fetch;
  return { fetching, asked };
}

const opened = (asked: readonly { path: string }[]) =>
  asked.some((each) => each.path.startsWith(`/v1/components/${COMPONENT}`));

afterEach(() => {
  forgetSupportRead();
  window.location.hash = '';
});

describe("a support person's own view (support.md; the SA plan, SAc)", () => {
  it('shows a support person on every page what their access reaches and until when', async () => {
    window.location.hash = '#/';
    const { fetching } = service('content');
    render(<Workspace fetch={fetching} />);
    const banner = await screen.findByRole('region', { name: 'Support access' });
    expect(banner).toHaveTextContent(
      /^You have support access: content in Clinical until 20 Nov 2026/,
    );
    window.location.hash = '#/admin/diagnostics';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(await screen.findByRole('region', { name: 'Support access' })).toBe(banner);
  });

  it('ADM-026 asks a content-scope support person before opening content, fetching none of it until they choose, then says why on every read', async () => {
    const user = userEvent.setup();
    window.location.hash = `#/components/${COMPONENT}`;
    const { fetching, asked } = service('content');
    render(<Workspace fetch={fetching} />);
    expect(
      await screen.findByRole('heading', { name: 'Read this content under support access?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/for this reason: Why the outline will not save\./),
    ).toBeInTheDocument();
    expect(opened(asked)).toBe(false);
    expect(asked.every((each) => each.said === null)).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Read under support access' }));
    expect(await screen.findAllByText('Dosing table')).not.toHaveLength(0);
    const reads = asked.filter((each) => each.path === `/v1/components/${COMPONENT}`);
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((each) => each.said === 'Why the outline will not save')).toBe(true);
  });

  it('ADM-026 shows content withheld from a metadata-scope support person, never asking for it', async () => {
    window.location.hash = `#/components/${COMPONENT}`;
    const { fetching, asked } = service('metadata');
    render(<Workspace fetch={fetching} />);
    expect(
      await screen.findByText(
        'Withheld under support access: your access reaches titles and names, not content.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Read under support access' })).toBeNull();
    expect(opened(asked)).toBe(false);
  });
});
