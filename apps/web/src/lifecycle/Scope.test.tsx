import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ScopeButton, ScopeChips, type ScopeNow } from './Scope.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const PRINTER = 'cccccccc-0000-4000-8000-000000000001';
const GRACE = '22222222-2222-4222-8222-222222222222';
const MARKET = '00000000-0000-4000-8000-0000000000a1';
const version = { id: '00000000-0000-4000-8000-0000000000f1', number: '0.1' };

/** The environment's one axis, Market, its people, and the scope and acceptance routes. */
function service() {
  const asked: { method: string; path: string; body: unknown }[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const body = request.method === 'GET' ? undefined : ((await request.json()) as unknown);
    asked.push({ method: request.method, path: url.pathname, body });
    if (url.pathname === '/v1/definitions') {
      return json(200, {
        items: [{ id: MARKET, kind: 'conditionAxis', name: 'Market', key: 'market', version }],
        next: null,
      });
    }
    if (url.pathname === `/v1/definitions/${MARKET}`) {
      return json(200, {
        id: MARKET,
        kind: 'conditionAxis',
        version,
        definition: {
          name: 'Market',
          key: 'market',
          values: [
            { key: 'us', label: 'United States' },
            { key: 'eu', label: 'Europe' },
          ],
        },
      });
    }
    if (url.pathname === '/v1/people') {
      return json(200, { items: [{ id: GRACE, name: 'Grace' }], next: null });
    }
    if (url.pathname === `/v1/components/${PRINTER}/scope`) {
      return json(200, {
        scope: [
          { axis: 'market', value: 'us', party: { kind: 'principal', id: GRACE, name: 'Grace' } },
        ],
        pending: [],
      });
    }
    if (url.pathname === `/v1/components/${PRINTER}/effective`) {
      const scope = url.searchParams.get('scope');
      return json(200, {
        scope: scope === null ? null : { axis: 'market', value: scope.split(':')[1] },
        at: url.searchParams.get('at') ?? '2026-10-17T09:00:00.000Z',
        revision:
          scope === 'market:us'
            ? { number: 2, version: version.id, at: '2026-10-17T08:00:00.000Z' }
            : { number: 1, version: version.id, at: '2026-10-01T08:00:00.000Z' },
        why: scope === 'market:us' ? 'scoped' : 'unscoped',
      });
    }
    if (url.pathname === `/v1/components/${PRINTER}/acceptance`) {
      return json(200, { ...(body as object), accepted: true });
    }
    return json(404, {});
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://scope.test', fetch: fetching }), asked };
}

const pending = (mayAccept: boolean): ScopeNow => ({
  scope: [{ axis: 'market', value: 'us', party: { kind: 'principal', id: GRACE, name: 'Grace' } }],
  pending: [
    {
      revision: 2,
      axis: 'market',
      value: 'us',
      party: { kind: 'principal', id: GRACE, name: 'Grace' },
      mayAccept,
    },
  ],
});

describe('scopes in a header (the R15 plan, R15-B, R15-E)', () => {
  it('LIF-047 says what it is effective for and what waits on acceptance, offering Accept to the party alone', async () => {
    const { client, asked } = service();
    const accepted = vi.fn();
    const { rerender } = render(
      <ScopeChips
        client={client}
        kind="component"
        id={PRINTER}
        scope={pending(false)}
        onAccepted={accepted}
      />,
    );
    expect(screen.getByText('Effective for market us')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Revision 2 waits on Grace for market us; the revision before stays effective there',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Accept/ })).toBeNull();

    rerender(
      <ScopeChips
        client={client}
        kind="component"
        id={PRINTER}
        scope={pending(true)}
        onAccepted={accepted}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Accept revision 2 for market us' }));
    await waitFor(() => expect(accepted).toHaveBeenCalled());
    expect(asked.at(-1)).toMatchObject({
      method: 'POST',
      path: `/v1/components/${PRINTER}/acceptance`,
      body: { revision: 2, axis: 'market', value: 'us' },
    });
  });

  it('LIF-042 sets the values a next revision is effective for, each with who accepts it there', async () => {
    const { client, asked } = service();
    const saved = vi.fn();
    render(
      <ScopeButton
        client={client}
        kind="component"
        id={PRINTER}
        title="Install the printer"
        scope={{ scope: [], pending: [] }}
        onSaved={saved}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Effective for' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Effective for: Install the printer',
    });
    const market = await within(dialog).findByRole('group', { name: 'Market' });
    await userEvent.click(within(market).getByRole('checkbox', { name: 'United States' }));
    await userEvent.selectOptions(
      within(market).getByRole('combobox', { name: 'Accepted in United States by' }),
      await within(market).findByRole('option', { name: 'Grace' }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(asked.at(-1)).toMatchObject({
      method: 'PUT',
      path: `/v1/components/${PRINTER}/scope`,
      body: { scope: [{ axis: 'market', value: 'us', party: { kind: 'principal', id: GRACE } }] },
    });
  });

  it('LIF-047 keeps a group named to accept as it was, saved unchanged', async () => {
    const { client, asked } = service();
    const REVIEWERS = '33333333-3333-4333-8333-333333333333';
    render(
      <ScopeButton
        client={client}
        kind="component"
        id={PRINTER}
        title="Install the printer"
        scope={{
          scope: [
            {
              axis: 'market',
              value: 'eu',
              party: { kind: 'group', id: REVIEWERS, name: 'Reviewers' },
            },
          ],
          pending: [],
        }}
        onSaved={() => undefined}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Effective for' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Effective for: Install the printer',
    });
    const market = await within(dialog).findByRole('group', { name: 'Market' });
    expect(
      within(market).getByRole('combobox', { name: 'Accepted in Europe by' }),
    ).toHaveDisplayValue('Group: Reviewers');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(asked.at(-1)).toMatchObject({
        method: 'PUT',
        body: { scope: [{ axis: 'market', value: 'eu', party: { kind: 'group', id: REVIEWERS } }] },
      }),
    );
  });

  it('LIF-043 answers, for a scope and a day anybody may ask, the one revision effective there then', async () => {
    const { client, asked } = service();
    render(
      <ScopeButton
        client={client}
        kind="component"
        id={PRINTER}
        title="Install the printer"
        scope={{ scope: [], pending: [] }}
        onSaved={() => undefined}
        mayEdit={false}
      />,
    );
    // A reader is asked what was effective alone.
    await userEvent.click(screen.getByRole('button', { name: 'Effective for' }));
    const whole = await screen.findByRole('dialog', { name: 'Effective for: Install the printer' });
    expect(within(whole).queryByRole('button', { name: 'Save' })).toBeNull();
    const dialog = within(whole).getByRole('form', { name: 'What was effective' });
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Where' }),
      await within(dialog).findByRole('option', { name: 'Market: United States' }),
    );
    const when = within(dialog).getByLabelText('When');
    await userEvent.clear(when);
    await userEvent.type(when, '2026-10-17T10:00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ask' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent(
      'Revision 2, effective for Market: United States then.',
    );
    const query = asked.at(-1)!.path;
    expect(query).toBe(`/v1/components/${PRINTER}/effective`);

    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Where' }),
      'Market: Europe',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ask' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('status')).toHaveTextContent(
        'Revision 1, effective everywhere then: none was effective for Market: Europe.',
      ),
    );
  });
});
