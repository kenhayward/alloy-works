import { crc32 } from 'node:zlib';

import { dataFailure, type DataFailure } from '@alloy-works/domain';
import { Inflate } from 'fflate';

/**
 * A zip read with nothing trusted (the D6 plan, D6-I and its risks): the central directory read and
 * every entry's local header checked against it - name, method, flags, sizes and checksum - so a zip
 * reads one way or not at all; entries that overlap, or lie past the directory, refused; at most
 * 10,000 entries; nothing but stored or deflated, unencrypted, and no ZIP64, which no workbook under
 * the byte ceiling needs. Each entry is inflated a slice at a time, every inflated byte counted
 * against one budget across every entry, so a bomb stops at the budget and memory stays bounded by
 * it, and checked against its stated size and CRC-32 once whole. A malformed zip is
 * `result_mismatch`; one past the budget, or with more entries than allowed, `byte_limit`.
 */

/** The most entries a zip may hold: a workbook has a dozen or so, a flood a hundred thousand. */
export const MAX_ZIP_ENTRIES = 10_000;

/** How much of an entry is inflated at once: deflate expands at most about 1,032 to 1. */
const SLICE = 4096;

const END = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const DESCRIPTOR = 0x08074b50;

/** An entry as the central directory states it, its data's place checked against its local header. */
export interface ZipEntry {
  readonly name: string;
  readonly method: 0 | 8;
  readonly crc: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly dataStart: number;
}

/** What a zip's entries came to, each by its name in lower case (a package's part names ignore case). */
export type Zip =
  { readonly entries: ReadonlyMap<string, ZipEntry> } | { readonly failure: DataFailure };

/** A stop thrown from inside a reader's callback: the failure it names. */
export class Stopped extends Error {
  constructor(readonly failure: DataFailure) {
    super(failure.code);
  }
}

const malformed = (): { failure: DataFailure } => ({ failure: dataFailure('result_mismatch') });

/** The end of central directory record: the last one whose comment runs exactly to the end. */
function findEnd(body: Buffer): number {
  for (let at = body.length - 22; at >= 0 && at >= body.length - 22 - 0xffff; at -= 1) {
    if (body.readUInt32LE(at) === END && at + 22 + body.readUInt16LE(at + 20) === body.length) {
      return at;
    }
  }
  return -1;
}

/** Reads a zip's directory and checks every entry's local header against it. */
export function readZip(body: Buffer): Zip {
  const end = findEnd(body);
  if (end < 0) return malformed();
  const disk = body.readUInt16LE(end + 4);
  const directoryDisk = body.readUInt16LE(end + 6);
  const onDisk = body.readUInt16LE(end + 8);
  const count = body.readUInt16LE(end + 10);
  const directorySize = body.readUInt32LE(end + 12);
  const directoryAt = body.readUInt32LE(end + 16);
  // One disk, and no ZIP64: its markers are these fields at their largest.
  if (disk !== 0 || directoryDisk !== 0 || onDisk !== count) return malformed();
  if (count === 0xffff || directorySize === 0xffffffff || directoryAt === 0xffffffff) {
    return malformed();
  }
  if (count > MAX_ZIP_ENTRIES) return { failure: dataFailure('byte_limit') };
  // The directory runs exactly to the end record: nothing before the first entry is read, and
  // nothing hides between them.
  if (directoryAt + directorySize !== end) return malformed();

  const entries = new Map<string, ZipEntry>();
  const spans: [number, number][] = [];
  let at = directoryAt;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > end || body.readUInt32LE(at) !== CENTRAL) return malformed();
    const flags = body.readUInt16LE(at + 8);
    const method = body.readUInt16LE(at + 10);
    const crc = body.readUInt32LE(at + 16);
    const compressedSize = body.readUInt32LE(at + 20);
    const size = body.readUInt32LE(at + 24);
    const nameLength = body.readUInt16LE(at + 28);
    const extraLength = body.readUInt16LE(at + 30);
    const commentLength = body.readUInt16LE(at + 32);
    const startDisk = body.readUInt16LE(at + 34);
    const localAt = body.readUInt32LE(at + 42);
    const nameBytes = body.subarray(at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    if (at > end) return malformed();
    // Encrypted, or a method other than stored or deflated, or another disk: none is read.
    if ((flags & 0x41) !== 0 || (method !== 0 && method !== 8) || startDisk !== 0) {
      return malformed();
    }
    if (method === 0 && compressedSize !== size) return malformed();
    if (size === 0xffffffff || compressedSize === 0xffffffff || localAt === 0xffffffff) {
      return malformed();
    }

    // The local header says what the directory says, or the zip is read no way at all.
    if (localAt + 30 > directoryAt || body.readUInt32LE(localAt) !== LOCAL) return malformed();
    const localFlags = body.readUInt16LE(localAt + 6);
    const localMethod = body.readUInt16LE(localAt + 8);
    const localCrc = body.readUInt32LE(localAt + 14);
    const localCompressed = body.readUInt32LE(localAt + 18);
    const localSize = body.readUInt32LE(localAt + 22);
    const localNameLength = body.readUInt16LE(localAt + 26);
    const localExtraLength = body.readUInt16LE(localAt + 28);
    const localName = body.subarray(localAt + 30, localAt + 30 + localNameLength);
    if (localFlags !== flags || localMethod !== method || !localName.equals(nameBytes)) {
      return malformed();
    }
    const described = (flags & 0x08) !== 0;
    const stated = (local: number, central: number) =>
      local === central || (described && local === 0);
    if (
      !stated(localCrc, crc) ||
      !stated(localCompressed, compressedSize) ||
      !stated(localSize, size)
    ) {
      return malformed();
    }
    const dataStart = localAt + 30 + localNameLength + localExtraLength;
    let spanEnd = dataStart + compressedSize;
    if (spanEnd > directoryAt) return malformed();
    if (described) {
      // The data descriptor after the data, its signature optional, says what the directory says.
      const signed = spanEnd + 4 <= directoryAt && body.readUInt32LE(spanEnd) === DESCRIPTOR;
      const fields = spanEnd + (signed ? 4 : 0);
      if (fields + 12 > directoryAt) return malformed();
      if (
        body.readUInt32LE(fields) !== crc ||
        body.readUInt32LE(fields + 4) !== compressedSize ||
        body.readUInt32LE(fields + 8) !== size
      ) {
        return malformed();
      }
      spanEnd = fields + 12;
    }
    spans.push([localAt, spanEnd]);

    const name = (flags & 0x800) !== 0 ? nameBytes.toString('utf8') : nameBytes.toString('latin1');
    const key = name.toLowerCase();
    // A name twice would read one way here and another elsewhere.
    if (entries.has(key)) return malformed();
    entries.set(key, { name, method, crc, compressedSize, size, dataStart });
  }
  if (at !== end) return malformed();
  // No two entries share a byte: overlapping entries are the bomb that inflates one stream many times.
  spans.sort((a, b) => a[0] - b[0]);
  for (let index = 1; index < spans.length; index += 1) {
    if (spans[index]![0] < spans[index - 1]![1]) return malformed();
  }
  return { entries };
}

/** What every entry inflated may come to, together: one budget, spent as bytes are inflated. */
export interface Budget {
  left: number;
}

/**
 * An entry's bytes, inflated a slice at a time and handed to `sink` as they come, each counted
 * against the budget - past it, `byte_limit` is thrown before the next slice - and the whole checked
 * against the entry's stated size and CRC-32. Throws `Stopped`.
 */
export function inflateEntry(
  body: Buffer,
  entry: ZipEntry,
  budget: Budget,
  sink: (chunk: Uint8Array, final: boolean) => void,
): void {
  let inflated = 0;
  let crc = 0;
  const take = (chunk: Uint8Array, final: boolean) => {
    inflated += chunk.length;
    budget.left -= chunk.length;
    if (budget.left < 0) throw new Stopped(dataFailure('byte_limit'));
    if (inflated > entry.size) throw new Stopped(dataFailure('result_mismatch'));
    crc = crc32(chunk, crc);
    sink(chunk, final);
  };
  const data = body.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
  if (entry.method === 0) {
    for (let at = 0; at < data.length || at === 0; at += SLICE) {
      take(data.subarray(at, at + SLICE), at + SLICE >= data.length);
      if (data.length === 0) break;
    }
  } else {
    let ended = false;
    const inflate = new Inflate((chunk, final) => {
      if (final) ended = true;
      take(chunk, final);
    });
    try {
      for (let at = 0; at < data.length || at === 0; at += SLICE) {
        inflate.push(data.subarray(at, at + SLICE), at + SLICE >= data.length);
        if (data.length === 0) break;
      }
    } catch (error) {
      if (error instanceof Stopped) throw error;
      // fflate's own refusal of a stream that is not deflate.
      throw new Stopped(dataFailure('result_mismatch'));
    }
    if (!ended) throw new Stopped(dataFailure('result_mismatch'));
  }
  if (inflated !== entry.size || crc >>> 0 !== entry.crc >>> 0) {
    throw new Stopped(dataFailure('result_mismatch'));
  }
}
