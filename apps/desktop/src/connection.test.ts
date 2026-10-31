import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { keepAddress, keptAddress } from './connection.js';

const made: string[] = [];
const folder = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'aw-connection-'));
  made.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the address kept between starts (the DR plan, DR-D)', () => {
  it('ADM-051 keeps the address in connection.json and reads it back on the next start', () => {
    const dir = folder();
    expect(keptAddress(dir)).toBeNull();
    keepAddress(dir, 'https://dev.acme.example');
    expect(keptAddress(dir)).toBe('https://dev.acme.example');
    keepAddress(dir, 'https://prod.acme.example');
    expect(keptAddress(dir)).toBe('https://prod.acme.example');
    // Written whole and renamed: no temporary file is left beside it.
    expect(readdirSync(dir)).toEqual(['connection.json']);
  });

  it('ADM-051 reads nothing from a file the shell would not take', () => {
    const dir = folder();
    writeFileSync(join(dir, 'connection.json'), '{"schemaVersion":1,"address":"file:///C:/x"}');
    expect(keptAddress(dir)).toBeNull();
  });
});
