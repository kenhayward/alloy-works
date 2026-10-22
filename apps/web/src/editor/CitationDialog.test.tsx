import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CitationDialog, NO_ENTRIES } from './CitationDialog.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SPACE = '11111111-1111-4111-8111-111111111111';
const MARLOW = '22222222-2222-4222-8222-222222222221';
const PENHALLOW = '22222222-2222-4222-8222-222222222222';
const version = { id: '33333333-3333-4333-8333-333333333333', number: '0.1' };
const summary = (id: string, key: string, family: string, title: string, year: number) => ({
  id,
  key,
  csl: {
    type: 'book',
    title,
    author: [{ family, given: 'Ada' }],
    issued: { 'date-parts': [[year]] },
  },
  version,
  changedAt: '2026-10-22T09:00:00.000Z',
});

/** Two pages of entries in the space. */
function service(pages = 2) {
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname !== `/v1/spaces/${SPACE}/bibliography-entries`) return json(404, {});
    if (pages === 0) return json(200, { items: [], next: null, total: 0 });
    return url.searchParams.get('cursor') === null
      ? json(200, {
          items: [summary(MARLOW, 'marlow2020', 'Marlow', 'Sediment and its movement', 2020)],
          next: 'page2',
          total: 2,
        })
      : json(200, {
          items: [summary(PENHALLOW, 'penhallow2018', 'Penhallow', 'Salt marshes', 2018)],
          next: null,
          total: 2,
        });
  }) as unknown as typeof fetch;
  return createApiClient({ baseUrl: 'http://citing.test', fetch: fetching });
}

const radios = () =>
  within(screen.getByRole('group', { name: 'Entry' }))
    .getAllByRole('radio')
    .map((each) => (each.closest('label') as HTMLElement).textContent);

describe('the Cite dialog (the CI plan, CId)', () => {
  it("offers every entry of the component's space, found by key, author or title, and answers the one chosen with its locator", async () => {
    const done = vi.fn(() => null);
    render(
      <CitationDialog
        client={service()}
        space={SPACE}
        current={null}
        onDone={done}
        onCancel={() => undefined}
      />,
    );
    const search = await screen.findByRole('searchbox', { name: 'Find an entry' });
    await screen.findByRole('radio', { name: /penhallow2018/ });
    expect(radios()).toEqual([
      'marlow2020: Marlow, Sediment and its movement, 2020',
      'penhallow2018: Penhallow, Salt marshes, 2018',
    ]);
    expect(search).toHaveFocus();
    for (const [typed, found] of [
      ['PENHALLOW', ['penhallow2018']],
      ['sediment', ['marlow2020']],
      ['marlow2020', ['marlow2020']],
    ] as const) {
      await userEvent.clear(search);
      await userEvent.type(search, typed);
      expect(radios().map((each) => each!.split(':')[0])).toEqual(found);
    }
    await userEvent.clear(search);
    await userEvent.type(search, 'salt');
    // The one found is chosen, so Enter cites it at once.
    expect(screen.getByRole('radio', { name: /penhallow2018/ })).toBeChecked();
    await userEvent.type(screen.getByRole('textbox', { name: /Locator/ }), 'p. 12');
    await userEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(done).toHaveBeenCalledWith({ entry: PENHALLOW, locator: 'p. 12' });
  });

  it('opens on the citation selected, and changes it with no locator once the locator is emptied', async () => {
    const done = vi.fn(() => null);
    render(
      <CitationDialog
        client={service()}
        space={SPACE}
        current={{ entry: PENHALLOW, locator: 'p. 3' }}
        onDone={done}
        onCancel={() => undefined}
      />,
    );
    const chosen = await screen.findByRole('radio', { name: /penhallow2018/ });
    expect(chosen).toBeChecked();
    const locator = screen.getByRole('textbox', { name: /Locator/ });
    expect(locator).toHaveValue('p. 3');
    await userEvent.clear(locator);
    await userEvent.click(screen.getByRole('radio', { name: /marlow2020/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(done).toHaveBeenCalledWith({ entry: MARLOW, locator: null });
  });

  it('says where the space holds no entry, offers nothing to insert, and closes on Escape', async () => {
    const cancelled = vi.fn();
    render(
      <CitationDialog
        client={service(0)}
        space={SPACE}
        current={null}
        onDone={() => null}
        onCancel={cancelled}
      />,
    );
    expect(await screen.findByText(NO_ENTRIES)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Insert' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(cancelled).toHaveBeenCalled();
  });
});
