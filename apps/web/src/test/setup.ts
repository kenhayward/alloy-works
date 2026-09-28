import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

import { keepEditingAgain } from '../editor/editing-storage.js';
import { armConsoleGate, releaseConsoleGate } from './consoleGate.js';

/**
 * jsdom keeps one `sessionStorage` for a whole file, and the component editor keeps its session there
 * for a reload (W11.3): left alone, one test's typing would be replayed into the next test that opens
 * the same component, as if it were that page reloaded. Every test starts with a window of its own.
 */
const clearSessionStorage = () => {
  try {
    globalThis.sessionStorage?.clear();
  } catch {
    // A test that took storage away puts it back itself.
  }
};

beforeEach(() => {
  clearSessionStorage();
  // And as a page that has just loaded, which keeps what it edits whoever signed out in the last test.
  keepEditingAgain();
  armConsoleGate();
});

afterEach(() => {
  cleanup();
  releaseConsoleGate();
  clearSessionStorage();
});
