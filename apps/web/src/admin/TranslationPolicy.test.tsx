import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TranslationPolicy } from './TranslationPolicy.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const change = (id: string, at: string, by: string | null, policy: object) => ({
  id,
  at,
  by: by === null ? null : { id: `${by}-id`, displayName: by },
  policy: {
    fallback: 'source',
    outOfDate: 'publish',
    note: {},
    conflict: 'review',
    machine: 'off',
    ...policy,
  },
});
const newest = {
  items: [
    change('c3', '2026-10-28T10:00:00Z', 'Grace', {
      fallback: 'refuse',
      note: { fr: 'Non traduit' },
    }),
    change('c2', '2026-10-27T10:00:00Z', 'Ada', { machine: 'inside' }),
  ],
  next: 'two',
};
const older = { items: [change('c1', '2026-10-01T10:00:00Z', null, {})], next: null };

function service() {
  let settings: unknown = {
    fallback: 'source',
    outOfDate: 'publish',
    note: {},
    conflict: 'review',
    machine: 'off',
  };
  const put: unknown[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/v1/settings/translation/history') {
      return json(200, url.searchParams.get('cursor') === 'two' ? older : newest);
    }
    if (request.method === 'PUT') {
      settings = (await request.json()) as unknown;
      put.push(settings);
    }
    return json(200, settings);
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), put };
}

describe("Administration's Translation", () => {
  it('shows the translation policy with its defaults and lets an administrator change it, with the mark’s words by language', async () => {
    const { client, put } = service();
    render(<TranslationPolicy client={client} mayChange />);
    expect(
      await screen.findByRole('radio', { name: /Publish it in its own language/ }),
    ).toBeChecked();
    expect(screen.getByRole('radio', { name: /Reported, where the change/ })).toBeChecked();
    await userEvent.click(screen.getAllByRole('radio', { name: /Refuse the publish/ })[0]!);
    await userEvent.type(
      screen.getByRole('textbox', { name: 'What the mark says, by language' }),
      'fr: Non traduit{Enter}de: Nicht übersetzt',
    );
    expect(screen.getByRole('radio', { name: /Hold it for review/ })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: /Offer to accept it/ }));
    expect(screen.getByRole('radio', { name: /Send nothing/ })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: /Only inside the data boundary/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(put).toEqual([
        {
          fallback: 'refuse',
          outOfDate: 'publish',
          note: { fr: 'Non traduit', de: 'Nicht übersetzt' },
          conflict: 'accept',
          machine: 'inside',
        },
      ]),
    );
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('shows the policy to somebody who may not change it, unchangeable, and none of its history', async () => {
    const { client } = service();
    render(<TranslationPolicy client={client} mayChange={false} />);
    expect(
      await screen.findByRole('radio', { name: /Publish it in its own language/ }),
    ).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('table', { name: 'Changes to the translation policy' })).toBeNull();
  });

  it('LOC-036 lists each change to the policy to an administrator, the newest first, whole, by whom and when, a page at a time', async () => {
    const { client } = service();
    render(<TranslationPolicy client={client} mayChange />);
    const table = await screen.findByRole('table', { name: 'Changes to the translation policy' });
    const rows = () => within(table).getAllByRole('row').slice(1);
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows()[0]).toHaveTextContent('Grace');
    expect(rows()[0]).toHaveTextContent('Refuse the publish');
    expect(rows()[0]).toHaveTextContent('fr: Non traduit');
    expect(rows()[1]).toHaveTextContent('Ada');
    expect(rows()[1]).toHaveTextContent('Only inside the data boundary');
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(rows()[2]).toHaveTextContent('As its history began');
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });
});
