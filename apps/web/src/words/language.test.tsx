import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Header } from '../shell/Header.js';
import { InterfaceLanguage } from './language.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A service that knows Ada, her language as chosen, and takes a new choice. */
function service(chosen: string | null) {
  let language = chosen;
  const put: unknown[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/v1/me') {
      return json(200, {
        id: 'p1',
        displayName: 'Ada',
        email: null,
        environment: 'Acme',
        outside: false,
        sharesOnly: false,
        interfaceLanguage: language,
      });
    }
    if (url.pathname === '/v1/me/preferences' && request.method === 'PUT') {
      const body = (await request.json()) as { interfaceLanguage: string | null };
      put.push(body);
      language = body.interfaceLanguage;
      return json(200, body);
    }
    if (url.pathname === '/v1/tenant') return json(200, { name: 'Acme', signIn: ['organisation'] });
    if (url.pathname === '/v1/inbox') return json(200, { items: [], unread: 0, next: null });
    return json(404, {});
  }) as unknown as typeof fetch;
  return { fetching, put };
}

describe('the interface’s language (the UI plan, UI-E)', () => {
  it('LOC-005 reads a person’s chosen language, says it on the page, and lets them choose another from the header', async () => {
    const { fetching, put } = service(null);
    render(
      <InterfaceLanguage fetch={fetching} browser={['fr-FR', 'en-GB']}>
        <Header fetch={fetching} />
      </InterfaceLanguage>,
    );
    await waitFor(() => expect(document.documentElement.lang).toBe('en-GB'));
    await userEvent.click(await screen.findByRole('button', { name: 'Interface language' }));
    expect(screen.getByRole('button', { name: 'As my browser says' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pseudo, right to left' }));
    expect(put).toEqual([{ interfaceLanguage: 'ar-XB' }]);
    // The whole interface turns, right to left, its words made over.
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    expect(document.documentElement.lang).toBe('ar-XB');
    expect(screen.getByRole('button', { name: /Ļåñĝûåĝé/ })).toBeInTheDocument();
  });

  it('opens right to left where the person chose so, before any word is read', async () => {
    const { fetching } = service('ar-XB');
    render(
      <InterfaceLanguage fetch={fetching} browser={['en-GB']}>
        <p>Content</p>
      </InterfaceLanguage>,
    );
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
  });
});
