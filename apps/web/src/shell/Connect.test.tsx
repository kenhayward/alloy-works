import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App.js';
import type { ConnectResult, PlatformBridge } from '../platform/bridge.js';

/**
 * The desktop's Connect to screen (the DR plan, DR-B): the renderer from disk, before any environment,
 * asking which to connect to and saying why an address was refused.
 */

const fetching = vi.fn(async () => new Response('{}', { status: 401 }));

beforeEach(() => {
  vi.stubGlobal('fetch', fetching);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetching.mockClear();
  window.location.hash = '';
});

function desktop(answer: ConnectResult, connectedTo?: string) {
  const connectTo = vi.fn(async () => answer);
  const bridge: PlatformBridge = {
    getPlatformInfo: async () => ({
      delivery: 'desktop',
      runtime: 'Electron 44.3.0',
      ...(connectedTo ? { connectedTo } : {}),
    }),
    opensServedPages: false,
    setSpellCheckLanguages: async () => {},
    setInterfaceLanguage: async () => {},
    connectTo,
  };
  return { bridge, connectTo };
}

describe('the Connect to screen (the DR plan, DR-B)', () => {
  it('ADM-051 asks for the environment alone, calling no service, and connects to the address typed', async () => {
    window.location.hash = '#/connect';
    const { bridge, connectTo } = desktop({ kind: 'connected', origin: 'https://acme.example' });
    render(<App bridge={bridge} environment={null} workspace={null} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Connect to Alloy Works' })).toBeTruthy();
    expect(screen.queryByRole('banner')).toBeNull();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Environment address' }),
      'https://acme.example',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(connectTo).toHaveBeenCalledWith('https://acme.example');
    expect(await screen.findByText('Connecting to https://acme.example')).toBeTruthy();
    expect(fetching).not.toHaveBeenCalled();
  });

  it('ADM-051 says why an address was refused, and keeps what was typed', async () => {
    window.location.hash = '#/connect';
    const { bridge } = desktop({ kind: 'refused', reason: 'no-environment' });
    render(<App bridge={bridge} environment={null} workspace={null} />);
    const field = screen.getByRole('textbox', { name: 'Environment address' });
    await userEvent.type(field, 'https://elsewhere.example');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Alloy Works answered, but has no environment at that address.',
    );
    expect((field as HTMLInputElement).value).toBe('https://elsewhere.example');
  });

  it('ADM-051 says an address did not answer where the shell could not be asked', async () => {
    window.location.hash = '#/connect';
    const { bridge, connectTo } = desktop({ kind: 'connected', origin: 'x' });
    connectTo.mockRejectedValueOnce(new Error('Refused'));
    render(<App bridge={bridge} environment={null} workspace={null} />);
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Environment address' }),
      'https://acme.example',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Nothing answered at that address. Check it, and your connection.',
    );
    expect(screen.getByRole('button', { name: 'Connect' })).toHaveProperty('disabled', false);
  });

  it('ADM-051 says the last address did not answer, and offers it again', async () => {
    window.location.hash = '#/connect?unreachable';
    const { bridge } = desktop({ kind: 'connected', origin: 'x' }, 'https://acme.example');
    render(<App bridge={bridge} environment={null} workspace={null} />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'https://acme.example did not answer. Check your connection and try again, or connect to another address.',
    );
    expect(
      (screen.getByRole('textbox', { name: 'Environment address' }) as HTMLInputElement).value,
    ).toBe('https://acme.example');
  });

  it('is not in the browser, which is at an address already', () => {
    window.location.hash = '#/connect';
    const { bridge } = desktop({ kind: 'connected', origin: 'x' });
    const browser: PlatformBridge = { ...bridge };
    delete browser.connectTo;
    render(<App bridge={browser} environment={null} workspace={null} />);
    expect(screen.queryByRole('heading', { name: 'Connect to Alloy Works' })).toBeNull();
  });
});
