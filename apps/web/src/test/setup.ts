import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

import { armConsoleGate, releaseConsoleGate } from './consoleGate.js';

beforeEach(armConsoleGate);

afterEach(() => {
  cleanup();
  releaseConsoleGate();
});
