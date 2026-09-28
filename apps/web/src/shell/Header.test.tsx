import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Header, initialsOf } from './Header.js';

/** The service, as far as the header band is concerned. */
function serviceThat(answers: Record<string, unknown>, posted: string[] = []) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const asked = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(asked.url, 'http://header.test').pathname;
    if (asked.method === 'POST') {
      posted.push(path);
      return new Response(null, { status: 204 });
    }
    const answer = answers[path];
    if (answer === undefined) return new Response('{}', { status: 404 });
    if (answer instanceof Response) return answer.clone();
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

const signedIn = {
  '/v1/tenant': { name: 'Development' },
  '/v1/me': { id: 'p1', displayName: 'Ada Lovelace', email: 'ada@example.com' },
};

const signedOut = {
  '/v1/tenant': { name: 'Development' },
  '/v1/me': new Response('{"code":"unauthenticated"}', {
    status: 401,
    headers: { 'content-type': 'application/json' },
  }),
};

afterEach(() => vi.restoreAllMocks());

describe('the header band', () => {
  it('shows the product, the module, the environment and who is signed in', async () => {
    render(<Header module="Documents" fetch={serviceThat(signedIn)} />);

    const band = screen.getByRole('banner');
    expect(within(band).getByRole('link', { name: /Alloy Works/ })).toBeInTheDocument();
    expect(within(band).getByText('Documents')).toBeInTheDocument();
    expect(await within(band).findByText('Development')).toBeInTheDocument();
    expect(await within(band).findByRole('button', { name: /Ada Lovelace/ })).toBeInTheDocument();
  });

  it('names no module on Home', async () => {
    render(<Header module={null} fetch={serviceThat(signedIn)} />);
    const band = screen.getByRole('banner');
    expect(await within(band).findByText('Development')).toBeInTheDocument();
    for (const name of ['Components', 'Documents', 'Publications']) {
      expect(within(band).queryByText(name)).not.toBeInTheDocument();
    }
  });

  it('offers Sign in when nobody is signed in', async () => {
    render(<Header module="Components" fetch={serviceThat(signedOut)} />);

    const link = await screen.findByRole('link', { name: 'Sign in' });
    expect(link).toHaveAttribute('href', '/v1/sign-in/organisation');
    expect(screen.queryByRole('button', { name: /Ada/ })).not.toBeInTheDocument();
  });

  it('signs out from the account chip', async () => {
    const posted: string[] = [];
    const signedOutNow = vi.fn();
    render(
      <Header
        module="Components"
        fetch={serviceThat(signedIn, posted)}
        onSignedOut={signedOutNow}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: /Ada Lovelace/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(signedOutNow).toHaveBeenCalled());
    expect(posted).toEqual(['/v1/sign-out']);
  });

  it('forgets everything kept in this window for editing as it signs out, so nobody signing in after is given it', async () => {
    const component = '6a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';
    sessionStorage.setItem(`alloy-works:editing-steps:${component}`, '{"kept":true}');
    sessionStorage.setItem(
      `alloy-works:editing-session:${component}`,
      '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b',
    );
    sessionStorage.setItem('alloy-works:pane-width', '320');
    const signedOutNow = vi.fn();
    render(<Header module="Components" fetch={serviceThat(signedIn)} onSignedOut={signedOutNow} />);

    await userEvent.click(await screen.findByRole('button', { name: /Ada Lovelace/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(signedOutNow).toHaveBeenCalled());
    expect(sessionStorage.getItem(`alloy-works:editing-steps:${component}`)).toBeNull();
    expect(sessionStorage.getItem(`alloy-works:editing-session:${component}`)).toBeNull();
    expect(sessionStorage.getItem('alloy-works:pane-width')).toBe('320');
  });

  it('forgets again, as it signs out, whatever was written for editing while the sign-out was on its way', async () => {
    const steps = 'alloy-works:editing-steps:6a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';
    const asked = serviceThat(signedIn);
    const signingOut = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      // Written while the sign-out is answered, as a save the editor had pending could write it.
      if (request.method === 'POST') sessionStorage.setItem(steps, '{"kept":true}');
      return asked(request);
    }) as unknown as typeof fetch;
    const signedOutNow = vi.fn(() => {
      expect(sessionStorage.getItem(steps)).toBeNull();
    });
    render(<Header module="Components" fetch={signingOut} onSignedOut={signedOutNow} />);

    await userEvent.click(await screen.findByRole('button', { name: /Ada Lovelace/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(signedOutNow).toHaveBeenCalled());
    expect(sessionStorage.getItem(steps)).toBeNull();
  });

  it('returns to Home from the mark, which opens no menu', () => {
    render(<Header module="Components" fetch={serviceThat(signedIn)} />);

    expect(screen.getByRole('link', { name: /Alloy Works/ })).toHaveAttribute('href', '#/');
    expect(screen.queryByRole('button', { name: /Alloy Works/ })).not.toBeInTheDocument();
  });

  it('closes a menu on Escape, returning focus to its button', async () => {
    render(<Header module="Components" fetch={serviceThat(signedIn)} />);

    const chip = await screen.findByRole('button', { name: /Ada Lovelace/ });
    await userEvent.click(chip);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(chip).toHaveFocus();
  });

  it('opens Administration from the account chip, and closes it', async () => {
    render(
      <Header module="Components" fetch={serviceThat(signedIn)} about={<p>the scaffolding</p>} />,
    );

    await userEvent.click(await screen.findByRole('button', { name: /Ada Lovelace/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Administration' }));
    expect(screen.getByRole('dialog', { name: 'Administration' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^About/ }));
    expect(screen.getByText('the scaffolding')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers no Theme while there is one theme', async () => {
    render(<Header module="Components" fetch={serviceThat(signedIn)} />);

    await userEvent.click(await screen.findByRole('button', { name: /Ada Lovelace/ }));

    expect(screen.queryByRole('button', { name: /Theme/ })).not.toBeInTheDocument();
  });

  it('takes initials from the name, or the address when there is none', () => {
    expect(initialsOf({ displayName: 'Ada Lovelace', email: null })).toBe('AL');
    expect(initialsOf({ displayName: 'Grace', email: null })).toBe('G');
    expect(initialsOf({ displayName: 'Alice de la Rue', email: null })).toBe('AR');
    expect(initialsOf({ displayName: null, email: 'ada@example.com' })).toBe('A');
    expect(initialsOf({ displayName: null, email: null })).toBe('?');
  });
});

describe('the mark in the header band', () => {
  it('is a file that exists, since a missing image fails in silence', async () => {
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { MARK } = await import('./Header.js');
    expect(existsSync(join(process.cwd(), 'public', MARK))).toBe(true);
  });
});
