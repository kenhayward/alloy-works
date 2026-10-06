import { execFileSync, spawn } from 'node:child_process';

import { e2eTargets } from './targets.js';

const PROJECT = e2eTargets(process.env).composeProject;

/** The development source's one container in this project. */
function sourceContainer(): string {
  const ids = execFileSync(
    'docker',
    [
      'ps',
      '-q',
      '--filter',
      `label=com.docker.compose.project=${PROJECT}`,
      '--filter',
      'label=com.docker.compose.service=source-postgres',
    ],
    { encoding: 'utf8', timeout: 60_000 },
  )
    .split(/\s+/)
    .filter(Boolean);
  if (ids.length !== 1) throw new Error(`${PROJECT} runs ${ids.length} source containers`);
  return ids[0]!;
}

/** psql at the development source as its superuser, in its own container of this project. */
const psql = (...more: string[]) => [
  'exec',
  '-i',
  sourceContainer(),
  'psql',
  '-U',
  'postgres',
  '-d',
  'readings',
  '-v',
  'ON_ERROR_STOP=1',
  ...more,
];

/** Runs SQL at the development source as its superuser, in its own container of this project. */
export function atTheSource(sql: string): void {
  execFileSync('docker', psql(), { input: sql, encoding: 'utf8', timeout: 60_000 });
}

/** Asks the development source as its superuser: each row's columns joined by `|`, a row a line. */
export function askTheSource(sql: string): string[] {
  return execFileSync('docker', psql('-At'), { input: sql, encoding: 'utf8', timeout: 60_000 })
    .split(/\r?\n/)
    .filter((line) => line !== '');
}

/**
 * Holds `sql` open at the source in a session of its own, named `name`, until `release` ends that
 * session: a lock taken so, before a sleep, stops anything else reading the table it locks.
 */
export function holdingAtTheSource(name: string, sql: string): { release: () => void } {
  const held = spawn('docker', psql(), { stdio: ['pipe', 'ignore', 'ignore'] });
  held.stdin.end(`set application_name = '${name}';\n${sql}\n`);
  return {
    release: () => {
      atTheSource(
        `select pg_terminate_backend(pid) from pg_stat_activity where application_name = '${name}';`,
      );
      held.kill();
    },
  };
}
