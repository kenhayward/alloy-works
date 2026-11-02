import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * SeaweedFS left to itself sizes its volumes from free disk at a gigabyte each, and a bucket grows
 * seven: a runner short of disk finds no writable volume and every upload answers 500 (#623, #832).
 */
const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8');

describe('the object stores of a development stack and of CI', () => {
  it.each(['deploy/compose.yaml', 'deploy/sources/s3/start.sh', '.github/workflows/ci.yml'])(
    '%s counts its volumes rather than sizing them from free disk',
    (path) => {
      const text = read(path);
      const servers = text.split('-dir=/data').length - 1;
      expect(servers).toBeGreaterThan(0);
      expect(text.split('-volume.max=200').length - 1).toBe(servers);
      expect(text.split('-master.volumeSizeLimitMB=64').length - 1).toBe(servers);
    },
  );
});
