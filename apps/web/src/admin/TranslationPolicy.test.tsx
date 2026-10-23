import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TranslationPolicy } from './TranslationPolicy.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function service() {
  let settings: unknown = { fallback: 'source', outOfDate: 'publish', note: {} };
  const put: unknown[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
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
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(put).toEqual([
        {
          fallback: 'refuse',
          outOfDate: 'publish',
          note: { fr: 'Non traduit', de: 'Nicht übersetzt' },
        },
      ]),
    );
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('shows the policy to somebody who may not change it, unchangeable', async () => {
    const { client } = service();
    render(<TranslationPolicy client={client} mayChange={false} />);
    expect(
      await screen.findByRole('radio', { name: /Publish it in its own language/ }),
    ).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
