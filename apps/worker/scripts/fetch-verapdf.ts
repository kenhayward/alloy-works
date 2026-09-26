// Pulls the pinned veraPDF image the regression corpus runs in. Once per machine, as fetch-typst is,
// and in CI; `docker run` would pull it on first use, but a test should not wait on the network.
import { execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { VERAPDF_IMAGE } from '../src/testing/verapdf-server.js';

const run = promisify(execFile);

// Docker Hub refuses or rate-limits anonymous pulls now and then, which says nothing about the code
// under test: three tries, ten seconds apart, before the step fails.
const ATTEMPTS = 3;
for (let attempt = 1; ; attempt += 1) {
  try {
    await run('docker', ['pull', VERAPDF_IMAGE], { timeout: 600_000 });
    break;
  } catch (error) {
    if (attempt === ATTEMPTS) throw error;
    console.log(`Pulling ${VERAPDF_IMAGE} failed (attempt ${attempt} of ${ATTEMPTS}); retrying`);
    await sleep(10_000);
  }
}

// A pull by digest cannot fetch anything else, but say so from what Docker holds rather than assume it.
const { stdout } = await run('docker', [
  'image',
  'inspect',
  '--format',
  '{{json .RepoDigests}}',
  VERAPDF_IMAGE,
]);
const digests = JSON.parse(stdout) as string[];
if (!digests.includes(VERAPDF_IMAGE)) {
  throw new Error(`veraPDF pulled as ${digests.join(', ')}, not the pinned ${VERAPDF_IMAGE}`);
}
console.log(`veraPDF is ${VERAPDF_IMAGE}`);
