import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App.js';
import type { PlatformBridge } from './platform/bridge.js';

const desktopBridge: PlatformBridge = {
  getPlatformInfo: async () => ({ delivery: 'desktop', runtime: 'Electron 44.3.0' }),
};

describe('App', () => {
  it('renders a component from the domain package', async () => {
    render(<App bridge={desktopBridge} />);

    expect(await screen.findByRole('heading', { name: 'Alloy Works' })).toBeInTheDocument();
    expect(screen.getByText('Install the printer')).toBeInTheDocument();
    expect(screen.getByText(/revision 1/i)).toBeInTheDocument();
  });

  it('names the delivery it is running under', async () => {
    render(<App bridge={desktopBridge} />);

    expect(await screen.findByText(/desktop/i)).toBeInTheDocument();
    expect(screen.getByText(/Electron 44\.3\.0/)).toBeInTheDocument();
  });

  it('says so while the bridge has not answered yet', () => {
    const pending: PlatformBridge = { getPlatformInfo: () => new Promise(() => {}) };
    render(<App bridge={pending} />);

    expect(screen.getByText(/checking/i)).toBeInTheDocument();
  });
});
