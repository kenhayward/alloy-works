import '@testing-library/jest-dom/vitest';

import { cleanup, configure } from '@testing-library/react';
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

// A `find` or `waitFor` waits three seconds, not Testing Library's one: a file's first mount loads the
// editor, which on CI's runner has taken over a second (issue #302). A test still fails where what it
// waits for never comes.
configure({ asyncUtilTimeout: 3_000 });

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
