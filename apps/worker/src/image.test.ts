import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { VERAPDF_IMAGE } from './testing/verapdf-server.js';
import { VERAPDF_COMMAND } from './verapdf.js';

const DOCKERFILE = new URL('../../../deploy/Dockerfile', import.meta.url);

describe("the worker image's veraPDF", () => {
  it('is copied from the very image the suite checks with, pinned by the same digest', async () => {
    const dockerfile = await readFile(DOCKERFILE, 'utf8');

    // Declared once, before the first stage, so the stage that copies from it cannot name another.
    const declared = [...dockerfile.matchAll(/^ARG VERAPDF_IMAGE=(\S+)$/gm)].map(
      (match) => match[1],
    );
    expect(declared).toEqual([VERAPDF_IMAGE]);
    expect(dockerfile).toMatch(/^FROM \$\{VERAPDF_IMAGE\} AS verapdf$/m);
    // And named nowhere else in the file.
    expect(dockerfile.match(/verapdf\/cli/g)).toHaveLength(1);
  });

  it('holds veraPDF where the worker runs it from, beside its Java runtime', async () => {
    const dockerfile = await readFile(DOCKERFILE, 'utf8');
    const worker = dockerfile.slice(dockerfile.indexOf('FROM base AS worker'));

    expect(VERAPDF_COMMAND).toBe('/opt/verapdf/verapdf');
    expect(worker).toMatch(/^COPY --from=verapdf \/opt\/verapdf \/opt\/verapdf$/m);
    expect(worker).toMatch(/^COPY --from=verapdf \/opt\/java\/openjdk \/opt\/java\/openjdk$/m);
    expect(worker).toMatch(/JAVA_HOME=\/opt\/java\/openjdk/);
    // The image's build runs it, so an image that cannot is never made.
    expect(worker).toMatch(/\/opt\/verapdf\/verapdf --version/);
  });
});
