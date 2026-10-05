import { execFileSync } from 'node:child_process';

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

/** Runs SQL at the development source as its superuser, in its own container of this project. */
export function atTheSource(sql: string): void {
  execFileSync(
    'docker',
    [
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
    ],
    { input: sql, encoding: 'utf8', timeout: 60_000 },
  );
}
