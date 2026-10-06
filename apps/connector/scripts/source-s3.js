// The connector suite's own S3 source (the D6 plan, task 2): SeaweedFS from the image, the
// identities and the objects compose's `source-s3` uses (deploy/sources/s3), HTTPS by the
// development S3 CA, published on 127.0.0.1 alone at ALLOY_TEST_S3_SOURCE_PORT (8489 unless said
// otherwise). Never the development stack's object store, and never a port anything else is on.
//
//   node scripts/source-s3.js start   starts it, or says it is already running, and waits until seeded
//   node scripts/source-s3.js stop    removes it
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const IMAGE = 'chrislusf/seaweedfs:4.46';
const port = Number(process.env.ALLOY_TEST_S3_SOURCE_PORT ?? '8489');
if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 8333) {
  console.error('ALLOY_TEST_S3_SOURCE_PORT must be a free port from 1024 to 65535, and never 8333');
  process.exit(2);
}
const name = `alloy-connector-source-s3-${port}`;
const folder = fileURLToPath(new URL('../../../deploy/sources/s3', import.meta.url));

const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8' });

function running() {
  const inspect = docker('inspect', '--format', '{{.State.Running}}', name);
  return inspect.status === 0 ? inspect.stdout.trim() === 'true' : undefined;
}

function start() {
  const state = running();
  if (state === false) docker('rm', '-f', name);
  if (state !== true) {
    execFileSync(
      'docker',
      [
        'run',
        '--detach',
        '--name',
        name,
        '--publish',
        `127.0.0.1:${port}:8333`,
        '--volume',
        `${folder}:/srv/s3:ro`,
        '--entrypoint',
        'sh',
        IMAGE,
        '/srv/s3/start.sh',
      ],
      { stdio: 'inherit' },
    );
  }
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    if (docker('exec', name, 'test', '-f', '/tmp/seeded').status === 0) {
      console.log(`The S3 source is on 127.0.0.1:${port}, as ${name}.`);
      return;
    }
    spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 500)']);
  }
  console.error(`The S3 source was not seeded within 90 seconds; see docker logs ${name}.`);
  process.exit(1);
}

function stop() {
  docker('rm', '-f', '--volumes', name);
  console.log(`Removed ${name}.`);
}

const command = process.argv[2];
if (command === 'start') start();
else if (command === 'stop') stop();
else {
  console.error('Usage: node scripts/source-s3.js start|stop');
  process.exit(2);
}
