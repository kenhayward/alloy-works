import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The image build's downloads (issue #181). Here with the other repository-wide checks, for the
 * reason `decisions.test.ts` gives.
 */
const dockerfile = readFileSync(
  join(process.cwd(), '..', '..', 'deploy', 'Dockerfile'),
  'utf8',
).replace(/\\\r?\n/g, ' ');

describe('the image build', () => {
  it('retries a download the release host answers with an error, rather than failing the build on it', () => {
    // Invocations only: `curl` followed by its options, not the package named to apt-get.
    const downloads = dockerfile.match(/\bcurl\s+-[^&|;]*/g) ?? [];
    expect(downloads.length).toBeGreaterThan(0);
    for (const download of downloads) {
      expect(download).toMatch(/--retry \d+/);
      expect(download).toMatch(/--retry-all-errors/);
    }
  });
});
