// Builds the Word validator's image, which every test that makes a .docx runs. Once per machine, as
// fetch-verapdf is, and in CI; there is no image to pull, so this is a build from the pinned .NET
// images and the NuGet lock file, tagged by a hash of what it is built from.
import { execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { OOXML_CHECK_DIRECTORY, OOXML_CHECK_IMAGE } from '../src/testing/ooxml.js';

const run = promisify(execFile);

// An image already tagged with this hash was built from these exact sources, so there is nothing to
// do - and nothing to fetch, which keeps a second run working offline.
const built = await run('docker', ['image', 'inspect', OOXML_CHECK_IMAGE]).then(
  () => true,
  () => false,
);

if (!built) {
  // The build pulls from mcr.microsoft.com and restores from nuget.org, either of which can refuse or
  // time out now and then, which says nothing about the code under test: three tries, ten seconds
  // apart, before the step fails.
  const ATTEMPTS = 3;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await run('docker', ['build', '--tag', OOXML_CHECK_IMAGE, OOXML_CHECK_DIRECTORY], {
        maxBuffer: 16 * 1024 * 1024,
        timeout: 600_000,
      });
      break;
    } catch (error) {
      if (attempt === ATTEMPTS) throw error;
      console.log(
        `Building ${OOXML_CHECK_IMAGE} failed (attempt ${attempt} of ${ATTEMPTS}); retrying`,
      );
      await sleep(10_000);
    }
  }
}

// Say what Docker holds under the tag rather than assume the build put it there.
const { stdout } = await run('docker', [
  'image',
  'inspect',
  '--format',
  '{{.Id}}',
  OOXML_CHECK_IMAGE,
]);
console.log(`The Word validator is ${OOXML_CHECK_IMAGE} (${stdout.trim()})`);
