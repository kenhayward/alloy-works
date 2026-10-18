import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PersonalPrompts } from './PersonalPrompts.js';

const MINE = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const GENERAL = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const PROMPT = '3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f';
const NOW = '2026-10-18T09:00:00.000Z';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function service() {
  const sent: { path: string; body: unknown }[] = [];
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const text = await request.text();
    const body = text === '' ? undefined : (JSON.parse(text) as unknown);
    if (request.method === 'POST') sent.push({ path: url.pathname, body });
    if (url.pathname === '/v1/me/prompts' && request.method === 'GET') {
      return json(200, {
        items: [
          {
            id: MINE,
            title: 'Plain words',
            instructions: 'Say it plainly.',
            changedAt: NOW,
            promotedTo: null,
          },
        ],
      });
    }
    if (url.pathname === '/v1/me/prompts' && request.method === 'POST') {
      return json(200, {
        id: 'p2',
        title: 'Saved',
        instructions: 'x',
        changedAt: NOW,
        promotedTo: null,
      });
    }
    if (url.pathname === `/v1/me/prompts/${MINE}/promotion`) {
      return json(200, {
        personal: {
          id: MINE,
          title: 'Plain words',
          instructions: 'Say it plainly.',
          changedAt: NOW,
          promotedTo: PROMPT,
        },
        prompt: { id: PROMPT, space: { id: GENERAL, name: 'General' } },
      });
    }
    if (url.pathname === '/v1/spaces') {
      return json(200, {
        items: [{ id: GENERAL, name: 'General', archived: false, mayCreate: true }],
        next: null,
      });
    }
    if (url.pathname === '/v1/connections') {
      return json(200, { items: [], next: null, total: 0, facets: { spaces: [] } });
    }
    if (url.pathname === '/v1/access') {
      return json(200, {
        target: url.searchParams.get('target'),
        permissions: [{ permission: 'edit', allowed: true }],
      });
    }
    return json(404, { code: 'not_found', message: 'Not found' });
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://mine.test', fetch: fetching }), sent };
}

describe('your prompts', () => {
  it('uses a prompt of your own as what is asked, saves what is asked, and promotes one into a space', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    const onUse = vi.fn();
    render(<PersonalPrompts client={client} asking="Summarise it for engineers." onUse={onUse} />);
    const mine = await screen.findByRole('region', { name: 'Your prompts' });
    await user.click(await within(mine).findByRole('button', { name: 'Use Plain words' }));
    expect(onUse).toHaveBeenCalledWith('Say it plainly.');

    await user.type(
      within(mine).getByRole('textbox', { name: 'Save what is asked as' }),
      'Summaries',
    );
    await user.click(within(mine).getByRole('button', { name: 'Save' }));
    expect(sent).toContainEqual({
      path: '/v1/me/prompts',
      body: { title: 'Summaries', instructions: 'Summarise it for engineers.' },
    });

    await user.click(within(mine).getByRole('button', { name: 'Promote Plain words' }));
    const form = await within(mine).findByRole('form', { name: 'Promote Plain words' });
    await user.type(
      within(form).getByRole('textbox', { name: 'Models accepted' }),
      'claude-sonnet-5-5',
    );
    await user.click(within(form).getByRole('button', { name: 'Make it a prompt' }));
    expect(sent.at(-1)).toEqual({
      path: `/v1/me/prompts/${MINE}/promotion`,
      body: {
        space: GENERAL,
        context: [{ source: 'outline', scope: 'part' }],
        output: { componentType: null },
        models: { purpose: 'drafting', accepts: ['claude-sonnet-5-5'] },
      },
    });
    expect(
      await within(mine).findByText('"Plain words" is a prompt in General now, at draft.'),
    ).toBeVisible();
  });
});
