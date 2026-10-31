import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { storedAddress, storedFile } from './shell.js';

/**
 * The environment's address, kept between starts in the app's own folder (the DR plan, DR-D). Main
 * process only: it reads the disk, which shell.ts, bundled into the preload, may not. Not a secret.
 */
const FILE = 'connection.json';

/** The address kept in `folder`, or null where there is none the shell would take. */
export function keptAddress(folder: string): string | null {
  let text: string;
  try {
    text = readFileSync(join(folder, FILE), 'utf8');
  } catch {
    return null;
  }
  return storedAddress(text);
}

/** Keeps `origin` in `folder`, written whole to a temporary file and renamed over the last. */
export function keepAddress(folder: string, origin: string): void {
  const temporary = join(folder, `${FILE}.tmp`);
  writeFileSync(temporary, storedFile(origin), 'utf8');
  renameSync(temporary, join(folder, FILE));
}
