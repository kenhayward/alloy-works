import { readExif, readImageHeader } from './header.js';

/** What an image carried that an output does not (AST-007, AST-024), each named once. */
export type MetadataFound =
  'comment' | 'credentials' | 'exif' | 'gps' | 'iptc' | 'other' | 'text' | 'xmp';

export interface StrippedImage {
  readonly bytes: Uint8Array;
  /** What was dropped, sorted; empty where the image carried nothing, and its bytes are the original. */
  readonly found: readonly MetadataFound[];
}

/**
 * **An image as an output carries it** (the AL plan, AL-G; AST-007, AST-024): the original is kept
 * byte for byte, and what is published is this. EXIF, XMP, IPTC, comments, text and content
 * credentials go, with anything else not needed to draw it; its colour profile and transparency stay,
 * and so do how it is turned and its density, in a minimal EXIF of those alone. Its pixels are never
 * touched: only whole segments and chunks are left out. Takes an image the walk admits.
 */
export function stripImage(image: Uint8Array): StrippedImage {
  const read = readImageHeader(image);
  if (!read.ok) throw new Error('Only an admitted image is stripped');
  const bytes = image.subarray(0, read.header.end);
  const { kept, found } = read.header.format === 'png' ? stripPng(bytes) : stripJpeg(bytes);
  if (found.size === 0) return { bytes: image, found: [] };
  return { bytes: concat(kept), found: [...found].sort() };
}

const concat = (parts: readonly Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length));

/** The chunks a PNG is drawn by: its image, palette, transparency, colour and density. */
const PNG_KEPT = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'cICP',
  'mDCv',
  'cLLi',
  'sBIT',
  'bKGD',
  'pHYs',
]);

function stripPng(bytes: Uint8Array) {
  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  const found = new Set<MetadataFound>();
  for (let at = 8; at < bytes.length;) {
    const length =
      ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
    const type = ascii(bytes, at + 4, 4);
    const end = at + 12 + length;
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (PNG_KEPT.has(type)) kept.push(bytes.subarray(at, end));
    else if (type === 'eXIf') noteExif(data, found);
    else if (type === 'caBX') found.add('credentials');
    else if (type === 'iTXt' && ascii(data, 0, 18) === 'XML:com.adobe.xmp\u0000') found.add('xmp');
    else if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') found.add('text');
    else found.add('other');
    at = end;
  }
  return { kept, found };
}

/** EXIF found, and GPS where its first directory points at one (0x8825). */
function noteExif(tiff: Uint8Array, found: Set<MetadataFound>) {
  found.add('exif');
  const little = tiff[0] === 0x49;
  const u16 = (at: number) =>
    at + 2 > tiff.length
      ? 0
      : little
        ? tiff[at]! | (tiff[at + 1]! << 8)
        : (tiff[at]! << 8) | tiff[at + 1]!;
  const u32 = (at: number) =>
    at + 4 > tiff.length
      ? 0
      : little
        ? (tiff[at]! | (tiff[at + 1]! << 8) | (tiff[at + 2]! << 16) | (tiff[at + 3]! << 24)) >>> 0
        : ((tiff[at]! << 24) | (tiff[at + 1]! << 16) | (tiff[at + 2]! << 8) | tiff[at + 3]!) >>> 0;
  const directory = u32(4);
  const entries = u16(directory);
  for (let entry = 0; entry < entries; entry += 1) {
    if (u16(directory + 2 + entry * 12) === 0x8825) found.add('gps');
  }
}

/** A JPEG application segment's identifier at its start, as `ascii` reads it. */
const SEGMENT_IDS = {
  jfif: 'JFIF\u0000',
  jfxx: 'JFXX\u0000',
  exif: 'Exif\u0000\u0000',
  xmp: 'http://ns.adobe.com/xap/1.0/\u0000',
  xmpExtension: 'http://ns.adobe.com/xmp/extension/\u0000',
  icc: 'ICC_PROFILE\u0000',
  adobe: 'Adobe',
} as const;

const startsWith = (payload: Uint8Array, id: string) => ascii(payload, 0, id.length) === id;

function stripJpeg(bytes: Uint8Array) {
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  const found = new Set<MetadataFound>();
  let at = 2;
  while (at < bytes.length) {
    // Fill bytes before a marker, as the walk allows.
    let marker = at;
    while (bytes[marker + 1] === 0xff) marker += 1;
    const code = bytes[marker + 1]!;
    if (code === 0xd9) {
      kept.push(bytes.subarray(at, marker + 2));
      break;
    }
    const length = (bytes[marker + 2]! << 8) | bytes[marker + 3]!;
    const end = marker + 2 + length;
    const payload = bytes.subarray(marker + 4, end);
    const segment = bytes.subarray(at, end);
    if (code === 0xda) {
      const scanEnd = entropyEnd(bytes, end);
      kept.push(bytes.subarray(at, scanEnd));
      at = scanEnd;
      continue;
    }
    const drop = (kind: MetadataFound) => found.add(kind);
    if (code === 0xe0) {
      if (startsWith(payload, SEGMENT_IDS.jfif) || startsWith(payload, SEGMENT_IDS.jfxx))
        kept.push(segment);
      else drop('other');
    } else if (code === 0xe1) {
      if (startsWith(payload, SEGMENT_IDS.exif)) {
        const tiff = payload.subarray(SEGMENT_IDS.exif.length);
        noteExif(tiff, found);
        const minimal = minimalExif(readExif(tiff));
        if (minimal) kept.push(minimal);
      } else if (
        startsWith(payload, SEGMENT_IDS.xmp) ||
        startsWith(payload, SEGMENT_IDS.xmpExtension)
      ) {
        drop('xmp');
      } else drop('other');
    } else if (code === 0xe2) {
      if (startsWith(payload, SEGMENT_IDS.icc)) kept.push(segment);
      else drop('other');
    } else if (code === 0xeb) drop('credentials');
    else if (code === 0xed) drop('iptc');
    else if (code === 0xee) {
      if (startsWith(payload, SEGMENT_IDS.adobe)) kept.push(segment);
      else drop('other');
    } else if (code >= 0xe3 && code <= 0xef) drop('other');
    else if (code === 0xfe) drop('comment');
    else kept.push(segment);
    at = end;
  }
  return { kept, found };
}

/** Where a scan's entropy-coded data ends, as the walk finds it. */
function entropyEnd(bytes: Uint8Array, from: number): number {
  for (let at = from; at + 1 < bytes.length; at += 1) {
    if (bytes[at] !== 0xff) continue;
    const next = bytes[at + 1]!;
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
      at += 1;
      continue;
    }
    if (next === 0xff) continue;
    return at;
  }
  return bytes.length;
}

const be16 = (n: number) => [(n >>> 8) & 255, n & 255];
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

/**
 * An APP1 EXIF segment holding only how the image is turned and its density, in inches, big-endian;
 * none where it is upright and declares no density.
 */
function minimalExif(exif: { orientation: number; resolution: number | null }): Uint8Array | null {
  const entries: number[][] = [];
  const data: number[] = [];
  const { orientation, resolution } = exif;
  const count = (orientation === 1 ? 0 : 1) + (resolution === null ? 0 : 3);
  if (count === 0) return null;
  const dataAt = 8 + 2 + count * 12 + 4;
  if (orientation !== 1)
    entries.push([...be16(0x0112), ...be16(3), ...be32(1), ...be16(orientation), 0, 0]);
  if (resolution !== null) {
    const rational = () => {
      const offset = dataAt + data.length;
      data.push(...be32(Math.round(resolution * 100)), ...be32(100));
      return offset;
    };
    entries.push([...be16(0x011a), ...be16(5), ...be32(1), ...be32(rational())]);
    entries.push([...be16(0x011b), ...be16(5), ...be32(1), ...be32(rational())]);
    entries.push([...be16(0x0128), ...be16(3), ...be32(1), ...be16(2), 0, 0]);
  }
  const tiff = [
    0x4d,
    0x4d,
    0,
    42,
    ...be32(8),
    ...be16(count),
    ...entries.flat(),
    ...be32(0),
    ...data,
  ];
  const payload = [...[...SEGMENT_IDS.exif].map((c) => c.charCodeAt(0)), ...tiff];
  return Uint8Array.from([0xff, 0xe1, ...be16(payload.length + 2), ...payload]);
}
