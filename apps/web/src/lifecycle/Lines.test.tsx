import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LinesControl } from './Lines.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const PRINTER = 'cccccccc-0000-4000-8000-000000000001';
const US = '11111111-1111-4111-8111-111111111111';
const EU = '22222222-2222-4222-8222-222222222222';
const line = (id: string, name: string) => ({
  id,
  name,
  divergedFrom: { revision: 1, version: 'dddddddd-0000-4000-8000-000000000001' },
  at: '2026-10-17T09:00:00.000Z',
  closed: false,
});

function service() {
  const asked: { method: string; path: string; body: unknown }[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const body = request.method === 'GET' ? undefined : ((await request.json()) as unknown);
    asked.push({ method: request.method, path: url.pathname, body });
    if (url.pathname === `/v1/components/${PRINTER}/lines` && request.method === 'POST') {
      return json(200, line(EU, 'EU'));
    }
    return json(404, {});
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://lines.test', fetch: fetching }), asked };
}

describe('lines in a header (the R16 plan, R16-E)', () => {
  it('says which line is read and moves between them', async () => {
    const { client } = service();
    const go = vi.fn();
    render(
      <LinesControl
        client={client}
        componentId={PRINTER}
        line={US}
        lines={[line(US, 'US')]}
        revision={null}
        mayEdit={false}
        onGo={go}
      />,
    );
    const chooser = screen.getByRole('combobox', { name: 'Line' });
    expect(chooser).toHaveDisplayValue('US, from revision 1');
    await userEvent.selectOptions(chooser, 'Main line');
    expect(go).toHaveBeenCalledWith(`#/components/${PRINTER}`);
    // A reader begins no line.
    expect(screen.queryByRole('button', { name: 'Begin a line' })).toBeNull();
  });

  it('LIF-044 begins a line from the revision approved, by whoever may edit, and opens it', async () => {
    const { client, asked } = service();
    const go = vi.fn();
    render(
      <LinesControl
        client={client}
        componentId={PRINTER}
        line={undefined}
        lines={[]}
        revision={3}
        mayEdit
        onGo={go}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Begin a line' }));
    const dialog = await screen.findByRole('dialog', { name: 'Begin a line' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'EU');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Begin' }));
    await waitFor(() => expect(go).toHaveBeenCalledWith(`#/components/${PRINTER}/lines/${EU}`));
    expect(asked.at(-1)).toMatchObject({
      method: 'POST',
      path: `/v1/components/${PRINTER}/lines`,
      body: { revision: 3, name: 'EU' },
    });
  });
});
