import { createHash } from 'node:crypto';
import { closeSync, createReadStream, mkdirSync, openSync, readSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { Transform } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { JobRefused } from './refusal.js';

/**
 * **An archive read as untrusted input** (EI-K). Entries are read by exact name, so nothing can land
 * outside the folder given; a size is what its header says, and a table is refused past what the
 * manifest declared, so a small file cannot unpack without limit.
 */

const BLOCK = 512;
/** More than any one row holds: an outline's or a table's content is far below it. */
const MAX_LINE_BYTES = 64 * 1024 * 1024;
/** What a page may hold in memory: past it a page ends early, however few rows that is. */
const MAX_PAGE_BYTES = 32 * 1024 * 1024;
const ENTRY =
  /^(manifest\.json|schema\.json|secrets\.jsonl|references\.jsonl|tables\/[a-z0-9_]{1,63}\.jsonl\.gz|objects\/[0-9a-f]{64})$/;

const invalid = (message: string) => new JobRefused('export_invalid', message);

/** Writes each entry under `folder` by its name, once the name and its header have been checked. */
export function unpackArchive(path: string, folder: string): readonly string[] {
  const fd = openSync(path, 'r');
  const names: string[] = [];
  const seen = new Set<string>();
  try {
    const header = Buffer.alloc(BLOCK);
    let position = 0;
    let paxSize: number | undefined;
    for (;;) {
      if (readSync(fd, header, 0, BLOCK, position) < BLOCK) {
        throw invalid('The archive stops before it ends.');
      }
      position += BLOCK;
      if (header.every((byte) => byte === 0)) return names;
      const sum = parseInt(header.toString('utf8', 148, 154), 8);
      const blanked = Buffer.from(header);
      blanked.fill(' ', 148, 156);
      if (blanked.reduce((total, byte) => total + byte, 0) !== sum) {
        throw invalid('An entry in the archive is damaged.');
      }
      const name = header.toString('utf8', 0, 100).replace(/\0.*$/s, '');
      const type = header.toString('utf8', 156, 157);
      const stated = parseInt(header.toString('utf8', 124, 135), 8);
      if (!Number.isSafeInteger(stated) || stated < 0) {
        throw invalid('An entry in the archive is damaged.');
      }
      if (type === 'x') {
        if (stated > 64 * 1024) throw invalid('An entry in the archive is damaged.');
        const body = Buffer.alloc(stated);
        readSync(fd, body, 0, stated, position);
        const match = /\d+ size=(\d+)\n/.exec(body.toString('utf8'));
        paxSize = match ? Number(match[1]) : undefined;
        position += Math.ceil(stated / BLOCK) * BLOCK;
        continue;
      }
      if (type !== '0' && type !== '\0') throw invalid(`The archive holds an unexpected ${name}.`);
      if (!ENTRY.test(name)) throw invalid(`The archive holds an unexpected ${name}.`);
      if (seen.has(name)) throw invalid(`The archive holds ${name} twice.`);
      seen.add(name);
      const size = paxSize ?? stated;
      if (!Number.isSafeInteger(size)) throw invalid('An entry in the archive is damaged.');
      paxSize = undefined;
      copyOut(fd, position, size, join(folder, name));
      names.push(name);
      position += Math.ceil(size / BLOCK) * BLOCK;
    }
  } finally {
    closeSync(fd);
  }
}

function copyOut(fd: number, from: number, size: number, to: string) {
  // The folder's name comes from the entry pattern above, so this cannot leave `folder`.
  mkdirSync(dirname(to), { recursive: true });
  const out = openSync(to, 'w');
  try {
    const chunk = Buffer.alloc(1024 * 1024);
    let at = from;
    let left = size;
    while (left > 0) {
      const read = readSync(fd, chunk, 0, Math.min(chunk.length, left), at);
      if (read === 0) throw invalid('The archive stops before an entry ends.');
      writeSync(out, chunk, 0, read);
      at += read;
      left -= read;
    }
  } finally {
    closeSync(out);
  }
}

/** A table's lines, a page at a time, refused past the bytes the manifest said it holds. */
export async function* tablePages(
  file: string,
  declaredBytes: number,
  pageSize = 500,
): AsyncGenerator<readonly string[]> {
  // Counted before a line is held, so a small file cannot unpack without limit, nor one line fill memory.
  let bytes = 0;
  let sinceNewline = 0;
  const guarded = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length;
      const last = chunk.lastIndexOf(10);
      sinceNewline = last === -1 ? sinceNewline + chunk.length : chunk.length - last - 1;
      if (bytes > declaredBytes) {
        done(invalid('A table in the archive is larger than its manifest says.'));
      } else if (sinceNewline > MAX_LINE_BYTES) {
        done(invalid('A row in the archive is too large.'));
      } else {
        done(null, chunk);
      }
    },
  });
  const input = createReadStream(file);
  const gunzip = createGunzip();
  // A failure anywhere reaches the end of the chain, so the reading below sees it.
  input.on('error', (error) => guarded.destroy(error));
  gunzip.on('error', (error) => guarded.destroy(error));
  const lines = createInterface({
    input: input.pipe(gunzip).pipe(guarded),
    crlfDelay: Infinity,
  });
  const failure = new Promise<never>((_resolve, reject) => {
    guarded.once('error', reject);
  });
  void failure.catch(() => undefined);
  let page: string[] = [];
  let held = 0;
  const reading = lines[Symbol.asyncIterator]();
  for (;;) {
    const next = await Promise.race([reading.next(), failure]);
    if (next.done) break;
    const line = next.value;
    if (line === '') continue;
    page.push(line);
    held += line.length;
    if (page.length === pageSize || held >= MAX_PAGE_BYTES) {
      yield page;
      page = [];
      held = 0;
    }
  }
  if (page.length > 0) yield page;
}

/** The SHA-256 of a file on disk, as a stream. */
export async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
