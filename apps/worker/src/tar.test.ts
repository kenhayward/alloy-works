import { closeSync, openSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tarWriter } from './tar.js';

/** A ustar header's fields, read by offset as the standard lays them out. */
const entryAt = (archive: Buffer, at: number) => ({
  name: archive.toString('utf8', at, at + 100).replace(/\0.*$/s, ''),
  size: parseInt(archive.toString('utf8', at + 124, at + 135), 8),
  magic: archive.toString('utf8', at + 257, at + 262),
  sum: parseInt(archive.toString('utf8', at + 148, at + 154), 8),
});

describe('a tar archive (EI-O)', () => {
  let folder = '';

  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'aw-tar-'));
  });

  afterAll(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it('writes entries on 512-byte blocks with a valid checksum, and ends with two empty blocks', async () => {
    const onDisk = join(folder, 'source');
    await writeFile(onDisk, 'from a file');
    const path = join(folder, 'one.tar');
    const fd = openSync(path, 'w');
    const tar = tarWriter(fd);
    tar.bytes('manifest.json', Buffer.from('{}'));
    await tar.file('objects/abc', onDisk);
    tar.end();
    closeSync(fd);

    const archive = readFileSync(path);
    expect(archive.length % 512).toBe(0);
    const first = entryAt(archive, 0);
    expect(first).toMatchObject({ name: 'manifest.json', size: 2, magic: 'ustar' });
    const blank = Buffer.from(archive.subarray(0, 512));
    blank.fill(' ', 148, 156);
    expect(first.sum).toBe(blank.reduce((total, byte) => total + byte, 0));
    expect(archive.toString('utf8', 512, 514)).toBe('{}');
    const second = entryAt(archive, 1024);
    expect(second).toMatchObject({ name: 'objects/abc', size: 11 });
    expect(archive.toString('utf8', 1536, 1547)).toBe('from a file');
    expect(archive.subarray(2048).every((byte) => byte === 0)).toBe(true);
    expect(archive.length).toBe(2048 + 1024);
  });

  it('refuses a name a ustar header cannot hold, rather than cutting it', () => {
    const fd = openSync(join(folder, 'two.tar'), 'w');
    expect(() => tarWriter(fd).bytes('x'.repeat(101), Buffer.alloc(0))).toThrow(/too long/);
    closeSync(fd);
  });
});
