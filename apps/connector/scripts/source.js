// The connector suite's own source (the D1 plan, D1-K): PostgreSQL 18.6 from the image and the seed
// the compose file's `source-postgres` uses, TLS on with the image's own snakeoil pair, published on
// 127.0.0.1 alone at ALLOY_TEST_SOURCE_PORT (5434 unless said otherwise). Never the development
// stack's database, and never a port anything else is on.
//
//   node scripts/source.js start   starts it, or says it is already running, and waits until it answers
//   node scripts/source.js stop    removes it
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const IMAGE = 'postgres@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280';
const port = Number(process.env.ALLOY_TEST_SOURCE_PORT ?? '5434');
if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 5432) {
  console.error('ALLOY_TEST_SOURCE_PORT must be a free port from 1024 to 65535, and never 5432');
  process.exit(2);
}
const name = `alloy-connector-source-${port}`;
const seed = fileURLToPath(new URL('../../../deploy/sources/postgres.sql', import.meta.url));

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
        `127.0.0.1:${port}:5432`,
        '--env',
        'POSTGRES_PASSWORD=source-postgres-dev-password',
        '--env',
        'POSTGRES_DB=readings',
        '--volume',
        `${seed}:/docker-entrypoint-initdb.d/postgres.sql:ro`,
        IMAGE,
        'postgres',
        '-c',
        'ssl=on',
        '-c',
        'ssl_cert_file=/etc/ssl/certs/ssl-cert-snakeoil.pem',
        '-c',
        'ssl_key_file=/etc/ssl/private/ssl-cert-snakeoil.key',
      ],
      { stdio: 'inherit' },
    );
  }
  // The entry point seeds on a server listening on its socket alone, then restarts it on TCP: ready
  // is the server answering on TCP, after the seed.
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    const ready = docker('exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres');
    if (ready.status === 0) {
      console.log(`The source is on 127.0.0.1:${port}, as ${name}.`);
      return;
    }
    spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 500)']);
  }
  console.error(`The source did not answer within 90 seconds; see docker logs ${name}.`);
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
  console.error('Usage: node scripts/source.js start|stop');
  process.exit(2);
}
