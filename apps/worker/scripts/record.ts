// Records the publishing regression corpus's outputs, and its baselines' (PUB-075; testing/recorded.ts):
// every PDF and DOCX
// with no pin yet. `--accept` takes every difference too, for a change meant to make one; its pull
// request says why. Run on Linux, as CI is, since the pins are CI's bytes.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const accept = process.argv.includes('--accept');
const result = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run', 'src/regression.test.ts', 'src/baseline-publish.test.ts'],
  {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, ALLOY_RECORD: accept ? 'accept' : 'new' },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
);
process.exit(result.status ?? 1);
