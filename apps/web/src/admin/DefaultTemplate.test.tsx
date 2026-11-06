import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SpaceDialog } from './SpaceDialogs.js';

const GENERAL = { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'General' };
const QUALITY = { id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'Quality' };
const BLANK = 'ee000000-0000-4000-8000-000000000001';
const REPORT = 'ee000000-0000-4000-8000-000000000002';
const AUDIT = 'ee000000-0000-4000-8000-000000000003';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const item = (id: string, name: string, space: typeof GENERAL, isDefault = false) => ({
  id,
  name,
  space,
  version: { id: `${id.slice(0, -2)}a1`, number: '0.1' },
  changedAt: '2026-11-01T09:00:00Z',
  description: null,
  sections: 0,
  values: 0,
  requiredValues: 0,
  copied: 0,
  referenced: 0,
  headings: [],
  isDefault,
});

function service(status = 204) {
  const sent: { method: string; url: string; body: unknown }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url).pathname;
    const body = request.method === 'GET' ? undefined : await request.clone().json();
    sent.push({ method: request.method, url, body });
    if (url === '/v1/templates') {
      return json(200, {
        items: [
          item(AUDIT, 'Audit', QUALITY),
          item(BLANK, 'Blank', GENERAL, true),
          item(REPORT, 'Report', GENERAL),
        ],
        next: null,
      });
    }
    if (status === 204) return new Response(null, { status });
    return json(status, { code: 'template_not_in_space', message: 'Not here.', traceId: 't' });
  }) as typeof globalThis.fetch;
  return { client: createApiClient({ baseUrl: 'http://localhost', fetch }), sent };
}

describe("a space's default template", () => {
  it("TPL-074 lets a space's administrator choose its default from the space's own templates", async () => {
    const { client, sent } = service();
    const onDone = vi.fn();
    render(
      <SpaceDialog
        client={client}
        act={{
          kind: 'template',
          space: { ...GENERAL, archived: false, mayCreate: true, defaultTemplate: BLANK },
        }}
        onDone={onDone}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Default template of General' })).toBeVisible();
    const chosen = await screen.findByRole('combobox', { name: 'Default template' });
    await waitFor(() => expect(chosen).toHaveValue(BLANK));
    expect(screen.getAllByRole('option').map((each) => each.textContent)).toEqual([
      'Blank',
      'Report',
    ]);
    await userEvent.selectOptions(chosen, 'Report');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith('Report is the default template in General.'),
    );
    expect(sent.at(-1)).toEqual({
      method: 'PUT',
      url: `/v1/spaces/${GENERAL.id}/default-template`,
      body: { template: REPORT },
    });
  });

  it("says so where the service refuses, in the service's words", async () => {
    const { client } = service(409);
    render(
      <SpaceDialog
        client={client}
        act={{
          kind: 'template',
          space: { ...GENERAL, archived: false, mayCreate: true, defaultTemplate: null },
        }}
        onDone={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const chosen = await screen.findByRole('combobox', { name: 'Default template' });
    await screen.findByRole('option', { name: 'Report' });
    await userEvent.selectOptions(chosen, 'Report');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Not here.');
  });
});
