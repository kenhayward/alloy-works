import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
});
