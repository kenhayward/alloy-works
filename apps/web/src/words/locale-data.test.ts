import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_LANGUAGES_CLDR } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { LOCALE_DATA } from './locale-data.js';

describe('the interface’s locale data (the UI plan, UI-A)', () => {
  it('names the very versions it is bundled at, so a change of data is a change of version', () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    for (const [name, version] of Object.entries(LOCALE_DATA.formats)) {
      expect(manifest.dependencies[name], name).toBe(version);
    }
  });

  it('LOC-044 carries the CLDR the declared content languages are made from, raised together', () => {
    // FormatJS bundles CLDR without naming it; its own repository pinned `cldr-core` 48.2.0 when these
    // were published (2026-09-12 to 2026-10-05), so a raise of either is a raise of both.
    expect(LOCALE_DATA.cldr).toBe(CONTENT_LANGUAGES_CLDR);
  });
});
