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
    // Taken as the one platform it is published for, whatever the worker is built for: only its jars
    // are copied, which are the same on every one.
    expect(dockerfile).toMatch(/^ARG VERAPDF_PLATFORM=linux\/amd64$/m);
    expect(dockerfile).toMatch(
      /^FROM --platform=\$\{VERAPDF_PLATFORM\} \$\{VERAPDF_IMAGE\} AS verapdf$/m,
    );
    // And named nowhere else in the file.
    expect(dockerfile.match(/verapdf\/cli/g)).toHaveLength(1);
  });

  it('holds veraPDF where the worker runs it from, beside its Java runtime', async () => {
    const dockerfile = await readFile(DOCKERFILE, 'utf8');
    const worker = dockerfile.slice(dockerfile.indexOf('FROM base AS worker'));

    expect(VERAPDF_COMMAND).toBe('/opt/verapdf/verapdf');
    expect(worker).toMatch(/^COPY --from=verapdf \/opt\/verapdf \/opt\/verapdf$/m);
    // The image's build runs it, so an image that cannot is never made.
    expect(worker).toMatch(/\/opt\/verapdf\/verapdf --version/);
  });

  it("runs veraPDF on Debian's own Java runtime, so the image builds for every architecture", async () => {
    const dockerfile = await readFile(DOCKERFILE, 'utf8');
    const worker = dockerfile.slice(dockerfile.indexOf('FROM base AS worker'));

    // veraPDF's jars are the only thing taken from its image: its Java runtime is built for musl on
    // x86-64 alone, and an arm64 worker given it could not start it.
    expect(worker.match(/^COPY --from=verapdf .*$/gm)).toEqual([
      'COPY --from=verapdf /opt/verapdf /opt/verapdf',
    ]);
    expect(worker).not.toMatch(/musl-x86_64|\/opt\/java\/openjdk/);
    // Debian publishes this for each architecture the worker is built for.
    expect(worker).toMatch(
      /apt-get install -y --no-install-recommends[^\n]*openjdk-17-jre-headless/,
    );
  });
});
