import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { BROWSER_PARTS, browserPart } from './testing/parts.js';

describe('the browser suite in parts, one stack each on CI', () => {
  it('runs the whole suite, and writes browser.json, when no part is asked for', () => {
    expect(browserPart(undefined)).toEqual({ only: null, without: [], report: 'browser.json' });
    expect(browserPart('')).toEqual({ only: null, without: [], report: 'browser.json' });
  });

  it('runs a named part alone, and writes a report of its own', () => {
    const part = browserPart('accessibility');
    expect(part.only).toEqual(['src/accessibility.test.ts']);
    expect(part.report).toBe('browser-accessibility.json');
  });

  it('runs in the rest every file no part names, so a new file is never left out', () => {
    const rest = browserPart('rest');
    expect(rest.only).toBeNull();
    expect(rest.without).toEqual(Object.values(BROWSER_PARTS).flat());
    expect(rest.report).toBe('browser-rest.json');
  });

  it('names each file once, and only files that exist', () => {
    const named = Object.values(BROWSER_PARTS).flat();
    expect(new Set(named).size).toBe(named.length);
    for (const file of named) expect(existsSync(join(process.cwd(), file)), file).toBe(true);
  });

  it('refuses a part it does not know, rather than running nothing', () => {
    expect(() => browserPart('Accessibility')).toThrow(
      /ALLOY_BROWSER_PART is "Accessibility": one of accessibility, navigation, surfaces, rest/,
    );
  });
});
