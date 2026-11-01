import { describe, expect, it } from 'vitest';

import { readImageHeader } from './header.js';
import {
  adobe,
  bytes,
  chunk,
  exif,
  exifBlock,
  jfif,
  jpeg,
  png,
  segment,
  u16,
  u32,
} from './image-bytes.fixture.js';
import { stripImage } from './strip.js';

/** The markers of a JPEG's segments before its first scan, in order. */
const markers = (file: Uint8Array) => {
  const found: number[] = [];
  for (let at = 2; file[at + 1] !== 0xda;) {
    found.push(file[at + 1]!);
    at += 2 + ((file[at + 2]! << 8) | file[at + 3]!);
  }
  return found;
};

/** The types of a PNG's chunks, in order. */
const chunks = (file: Uint8Array) => {
  const found: string[] = [];
  for (let at = 8; at < file.length;) {
    const length =
      ((file[at]! << 24) | (file[at + 1]! << 16) | (file[at + 2]! << 8) | file[at + 3]!) >>> 0;
    found.push(String.fromCharCode(...file.subarray(at + 4, at + 8)));
    at += 12 + length;
  }
  return found;
};

const XMP = segment(0xe1, [...bytes('http://ns.adobe.com/xap/1.0/'), 0, ...bytes('<x:xmpmeta/>')]);
const ICC = segment(0xe2, [...bytes('ICC_PROFILE'), 0, 1, 1, ...Array(16).fill(7)]);
const IPTC = segment(0xed, [
  ...bytes('Photoshop 3.0'),
  0,
  ...bytes('8BIM'),
  4,
  4,
  0,
  0,
  0,
  0,
  0,
  0,
]);
const JUMBF = segment(0xeb, [...bytes('JP'), 0, 0, 0, 0, 0, 1, ...bytes('jumb')]);
const COMMENT = segment(0xfe, [...bytes('Taken by Ada at 51.5N')]);
/** A first directory pointing at a GPS directory (0x8825), as a phone's does. */
const WITH_GPS = exifBlock([
  { tag: 0x0112, type: 3, value: 6 },
  { tag: 0x011a, type: 5, value: [300, 1] },
  { tag: 0x011b, type: 5, value: [300, 1] },
  { tag: 0x0128, type: 3, value: 2 },
  { tag: 0x8825, type: 4, value: 0 },
]);

describe("an image's metadata stripped for an output (the AL plan, AL-G)", () => {
  it('AST-007 drops EXIF, XMP, IPTC and comments from a JPEG, keeping its colour and how it is turned and sized, and says what it found', () => {
    const original = jpeg({ before: [jfif(0, 0, 0), WITH_GPS, XMP, ICC, IPTC, COMMENT, adobe()] });
    const stripped = stripImage(original);
    expect(stripped.found).toEqual(['comment', 'exif', 'gps', 'iptc', 'xmp']);
    // JFIF, a minimal EXIF, the ICC profile and Adobe's colour transform: nothing else.
    expect(markers(stripped.bytes)).toEqual([0xe0, 0xe1, 0xe2, 0xee, 0xdb, 0xc0, 0xc4]);
    const before = readImageHeader(original);
    const after = readImageHeader(stripped.bytes);
    expect(after).toEqual({
      ok: true,
      header: { ...(before.ok && before.header), end: stripped.bytes.length },
    });
    expect(after.ok && after.header).toMatchObject({ orientation: 6, resolution: 300 });
    // Nothing of what was dropped is left anywhere in the file.
    const text = String.fromCharCode(...stripped.bytes);
    for (const gone of ['xap/1.0', 'Photoshop', 'Ada', '8BIM']) expect(text).not.toContain(gone);
    // The scan is the original's, byte for byte.
    const scanAt = (file: Uint8Array) =>
      file.findIndex((_, at) => file[at] === 0xff && file[at + 1] === 0xda);
    expect(stripped.bytes.subarray(scanAt(stripped.bytes))).toEqual(
      original.subarray(scanAt(original)),
    );
  });

  it('AST-024 removes content credentials, deliberately, and records that it did', () => {
    const stripped = stripImage(jpeg({ before: [JUMBF] }));
    expect(stripped.found).toEqual(['credentials']);
    expect(markers(stripped.bytes)).toEqual([0xdb, 0xc0, 0xc4]);
    const credentialed = png({ extra: [chunk('caBX', [...bytes('jumb'), 1, 2, 3])] });
    expect(stripImage(credentialed).found).toEqual(['credentials']);
  });

  it('keeps no EXIF where there was nothing to keep, and an image with nothing to drop as it was', () => {
    expect(markers(stripImage(jpeg({ before: [exif([[0x010f, 1]])] })).bytes)).toEqual([
      0xdb, 0xc0, 0xc4,
    ]);
    const plain = jpeg({ before: [jfif(1, 72, 72)] });
    expect(stripImage(plain)).toEqual({ bytes: plain, found: [] });
  });

  it('drops text, XMP and EXIF from a PNG, keeping its colour, transparency and density', () => {
    const original = png({
      colourType: 3,
      extra: [
        chunk('iCCP', [...bytes('sRGB'), 0, 0, 0x78, 0x9c]),
        chunk('tRNS', [0]),
        chunk('pHYs', [...u32(2835), ...u32(2835), 1]),
        chunk('tEXt', [...bytes('Author'), 0, ...bytes('Grace')]),
        chunk('iTXt', [...bytes('XML:com.adobe.xmp'), 0, 0, 0, 0, 0, ...bytes('<x:xmpmeta/>')]),
        chunk('eXIf', [...bytes('MM'), 0, 42, ...u32(8), ...u16(0), ...u32(0)]),
        chunk('tIME', [...u16(2026), 11, 1, 9, 0, 0]),
      ],
    });
    const stripped = stripImage(original);
    expect(stripped.found).toEqual(['exif', 'other', 'text', 'xmp']);
    expect(chunks(stripped.bytes)).toEqual([
      'IHDR',
      'PLTE',
      'iCCP',
      'tRNS',
      'pHYs',
      'IDAT',
      'IEND',
    ]);
    const before = readImageHeader(original);
    expect(readImageHeader(stripped.bytes)).toEqual({
      ok: true,
      header: { ...(before.ok && before.header), end: stripped.bytes.length },
    });
  });
});
