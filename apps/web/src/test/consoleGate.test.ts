import { describe, expect, it } from 'vitest';

import { allowConsoleNoise } from './consoleGate.js';

// The gate is armed for every test by setup.ts, so these run against the real thing.
describe('the console gate', () => {
  it('fails a test that logs an error', () => {
    expect(() => console.error('boom')).toThrow(/console\.error during a test: boom/);
  });

  it('fails a test that logs a warning', () => {
    expect(() => console.warn('careful')).toThrow(/console\.warn during a test: careful/);
  });

  it('lets a test opt out when it provokes the noise on purpose', () => {
    allowConsoleNoise();

    expect(() => console.error('expected')).not.toThrow();
  });

  it('re-arms for the next test after an opt-out', () => {
    expect(() => console.warn('still gated')).toThrow();
  });
});
