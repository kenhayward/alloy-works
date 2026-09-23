import { describe, expect, it } from 'vitest';
import { ASSET_MAX_PIXELS, admittedFormat, crc32, readImageHeader } from './header.js';

// Every file here is built byte by byte, so a test says exactly what the walk is shown. Nothing is
// read from disk and nothing is decoded: the walk reads structure, and the worker's decoder is what
// proves the pixels (figures 1, R5).

const bytes = (...parts: (number[] | Uint8Array | string)[]): Uint8Array => {
  const flat: number[] = [];
  for (const part of parts) {
    if (typeof part === 'string') for (const c of part) flat.push(c.charCodeAt(0));
    else flat.push(...part);
  }
  return Uint8Array.from(flat);
};
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const chunk = (type: string, data: number[] = [], crcFix = 0) => {
  const body = bytes(type, data);
  return [...u32(data.length), ...body, ...u32((crc32(body) ^ crcFix) >>> 0)];
};
const ihdr = (width: number, height: number, depth = 8, colourType = 2, interlace = 0) =>
  chunk('IHDR', [...u32(width), ...u32(height), depth, colourType, 0, 0, interlace]);

interface PngOptions {
  width?: number;
  height?: number;
  depth?: number;
  colourType?: number;
  extra?: number[][];
  after?: number[];
  withoutIdat?: boolean;
}
const png = (options: PngOptions = {}) =>
  bytes(
    SIGNATURE,
    ihdr(options.width ?? 800, options.height ?? 500, options.depth, options.colourType),
    ...(options.colourType === 3 ? [chunk('PLTE', [0, 0, 0, 255, 255, 255])] : []),
    ...(options.extra ?? []),
    ...(options.withoutIdat ? [] : [chunk('IDAT', [0x78, 0x9c, 1, 2, 3])]),
    chunk('IEND'),
    options.after ?? [],
  );

const segment = (marker: number, payload: number[]) => [
  0xff,
  marker,
  ...u16(payload.length + 2),
  ...payload,
];
const sof = (marker: number, width: number, height: number, components: number, precision = 8) =>
  segment(marker, [
    precision,
    ...u16(height),
    ...u16(width),
    components,
    ...Array.from({ length: components }, (_, at) => [at + 1, 0x11, 0]).flat(),
  ]);
const jfif = (units: number, x: number, y: number) =>
  segment(0xe0, [...bytes('JFIF'), 0, 1, 2, units, ...u16(x), ...u16(y), 0, 0]);
/** An EXIF block in big-endian TIFF order with IFD0 holding the entries given, each a SHORT. */
const exif = (entries: [tag: number, value: number][]) => {
  const ifd = [
    ...u16(entries.length),
    ...entries.flatMap(([tag, value]) => [...u16(tag), ...u16(3), ...u32(1), ...u16(value), 0, 0]),
    ...u32(0),
  ];
  return segment(0xe1, [...bytes('Exif'), 0, 0, ...bytes('MM'), 0, 42, ...u32(8), ...ifd]);
};
const adobe = () => segment(0xee, [...bytes('Adobe'), 0, 100, 0, 0, 0, 0, 2]);
const sos = (components: number) =>
  segment(0xda, [
    components,
    ...Array.from({ length: components }, (_, at) => [at + 1, 0]).flat(),
    0,
    63,
    0,
  ]);
/** Entropy-coded data carrying a stuffed 0xFF and a restart marker, which the walk must pass over. */
const SCAN = [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0x9a];

interface JpegOptions {
  width?: number;
  height?: number;
  components?: number;
  sofMarker?: number;
  precision?: number;
  before?: number[][];
  scans?: number;
  after?: number[];
  withoutEoi?: boolean;
}
const jpeg = (options: JpegOptions = {}) => {
  const components = options.components ?? 3;
  const scans = Array.from({ length: options.scans ?? 1 }, (_, at) => [
    ...(at > 0 ? segment(0xc4, [0x10, ...Array(16).fill(0)]) : []),
    ...sos(components),
    ...SCAN,
  ]).flat();
  return bytes(
    [0xff, 0xd8],
    ...(options.before ?? []),
    segment(0xdb, [0, ...Array(64).fill(1)]),
    sof(
      options.sofMarker ?? 0xc0,
      options.width ?? 800,
      options.height ?? 500,
      components,
      options.precision,
    ),
    segment(0xc4, [0, ...Array(16).fill(0)]),
    scans,
    options.withoutEoi ? [] : [0xff, 0xd9],
    options.after ?? [],
  );
};

const refusal = (file: Uint8Array) => {
  const read = readImageHeader(file);
  return read.ok ? 'accepted' : read.refusal;
};

describe('the header walk (figures 1)', () => {
  it('computes CRC-32 as PNG does', () => {
    // The standard check value, so a table built wrong cannot agree with itself.
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
  });

  describe('AST-002 AST-038 which format a file is, from its bytes alone', () => {
    it('names a PNG and a JPEG by their first bytes, and nothing else', () => {
      expect(admittedFormat(png())).toBe('png');
      expect(admittedFormat(jpeg())).toBe('jpeg');
      expect(admittedFormat(bytes('GIF89a', [0, 0, 0, 0]))).toBeNull();
      expect(admittedFormat(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '))).toBeNull();
      expect(admittedFormat(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
      expect(admittedFormat(bytes('II*', [0]))).toBeNull();
      expect(admittedFormat(bytes([0x89, 0x50]))).toBeNull();
    });

    it('refuses a file that is not a PNG or a JPEG as not permitted', () => {
      expect(refusal(bytes('GIF89a', [1, 0, 1, 0]))).toBe('not_permitted');
      expect(refusal(bytes('%PDF-1.7'))).toBe('not_permitted');
      expect(refusal(new Uint8Array())).toBe('not_permitted');
    });
  });

  describe('AST-005 what a PNG records', () => {
    it('reads its dimensions, colour, alpha and depth for every colour type', () => {
      const cases = [
        [0, 8, 'grey', false],
        [0, 16, 'grey', false],
        [2, 8, 'rgb', false],
        [2, 16, 'rgb', false],
        [3, 8, 'rgb', false],
        [4, 8, 'grey', true],
        [6, 8, 'rgb', true],
        [6, 16, 'rgb', true],
      ] as const;
      for (const [colourType, depth, colour, alpha] of cases) {
        const read = readImageHeader(png({ colourType, depth, width: 640, height: 480 }));
        expect(read, `colour type ${colourType} at ${depth}`).toEqual({
          ok: true,
          header: {
            format: 'png',
            width: 640,
            height: 480,
            orientation: 1,
            colour,
            alpha,
            depth: depth === 16 ? 16 : 8,
            resolution: null,
          },
        });
      }
    });

    it('counts a palette with transparency as having alpha', () => {
      const read = readImageHeader(png({ colourType: 3, extra: [chunk('tRNS', [0])] }));
      expect(read.ok && read.header.alpha).toBe(true);
    });

    it('reads a resolution declared in pixels per metre, and none where the unit is unknown', () => {
      // 11811 pixels per metre is 300 dots per inch, to two places.
      const perMetre = png({ extra: [chunk('pHYs', [...u32(11811), ...u32(11811), 1])] });
      const unknown = png({ extra: [chunk('pHYs', [...u32(11811), ...u32(11811), 0])] });
      expect(readImageHeader(perMetre)).toMatchObject({
        header: { resolution: 300 },
      });
      expect(readImageHeader(unknown)).toMatchObject({ header: { resolution: null } });
    });
  });

  describe('AST-005 what a JPEG records', () => {
    it('reads a baseline and a progressive JPEG, in colour, grey and CMYK', () => {
      expect(readImageHeader(jpeg())).toEqual({
        ok: true,
        header: {
          format: 'jpeg',
          width: 800,
          height: 500,
          orientation: 1,
          colour: 'rgb',
          alpha: false,
          depth: 8,
          resolution: null,
        },
      });
      expect(readImageHeader(jpeg({ sofMarker: 0xc2, scans: 3 }))).toMatchObject({ ok: true });
      expect(readImageHeader(jpeg({ components: 1 }))).toMatchObject({
        header: { colour: 'grey' },
      });
      expect(readImageHeader(jpeg({ components: 4, before: [adobe()] }))).toMatchObject({
        header: { colour: 'cmyk' },
      });
    });

    it('reads a resolution from JFIF in inches or centimetres, and none from an aspect ratio alone', () => {
      expect(readImageHeader(jpeg({ before: [jfif(1, 300, 300)] }))).toMatchObject({
        header: { resolution: 300 },
      });
      expect(readImageHeader(jpeg({ before: [jfif(2, 118, 118)] }))).toMatchObject({
        header: { resolution: 299.72 },
      });
      expect(readImageHeader(jpeg({ before: [jfif(0, 1, 1)] }))).toMatchObject({
        header: { resolution: null },
      });
    });

    it('records its dimensions as displayed, turned by its EXIF orientation, which the engine applies', () => {
      // Measured (assets.md): Typst sets a JPEG stored 800 by 500 with orientation 6 as 500 by 800.
      for (const orientation of [5, 6, 7, 8]) {
        expect(readImageHeader(jpeg({ before: [exif([[0x0112, orientation]])] }))).toMatchObject({
          header: { width: 500, height: 800, orientation },
        });
      }
      for (const orientation of [1, 2, 3, 4]) {
        expect(readImageHeader(jpeg({ before: [exif([[0x0112, orientation]])] }))).toMatchObject({
          header: { width: 800, height: 500, orientation },
        });
      }
    });

    it('passes over a stuffed byte and a restart marker in the scan, and the markers between scans', () => {
      expect(refusal(jpeg({ sofMarker: 0xc2, scans: 4 }))).toBe('accepted');
    });
  });

  describe('AST-040 AST-006 what the walk refuses', () => {
    it('refuses a byte after a PNG ends, which is where a second file hides', () => {
      expect(refusal(png({ after: [0] }))).toBe('malformed');
      expect(refusal(png({ after: [...bytes('PK'), 3, 4] }))).toBe('malformed');
    });

    it('refuses a byte after a JPEG ends, however it got there', () => {
      expect(refusal(jpeg({ after: [0] }))).toBe('malformed');
      expect(refusal(jpeg({ after: [0xff, 0xd9] }))).toBe('malformed');
    });

    it('refuses a PNG chunk whose CRC is wrong, a critical chunk it does not know, and a missing IDAT', () => {
      expect(refusal(png({ extra: [chunk('tEXt', [65], 1)] }))).toBe('malformed');
      expect(refusal(png({ extra: [chunk('ZZZZ', [1])] }))).toBe('malformed');
      // An ancillary chunk it does not know is the format's own extension point, and is passed over.
      expect(refusal(png({ extra: [chunk('zzZz', [1])] }))).toBe('accepted');
      expect(refusal(png({ withoutIdat: true }))).toBe('malformed');
    });

    it('refuses a PNG whose header is not a PNG header', () => {
      expect(refusal(png({ depth: 3 }))).toBe('malformed');
      expect(refusal(png({ colourType: 5 }))).toBe('malformed');
      expect(refusal(png({ width: 0 }))).toBe('malformed');
      expect(refusal(bytes(SIGNATURE, chunk('IDAT', [1]), ihdr(1, 1), chunk('IEND')))).toBe(
        'malformed',
      );
    });

    it('refuses a PNG carrying an EXIF orientation, which nothing in the pipeline has measured', () => {
      const turned = [
        ...bytes('MM'),
        0,
        42,
        ...u32(8),
        ...u16(1),
        ...u16(0x0112),
        ...u16(3),
        ...u32(1),
        ...u16(6),
        0,
        0,
        ...u32(0),
      ];
      expect(refusal(png({ extra: [chunk('eXIf', turned)] }))).toBe('malformed');
    });

    it('refuses a truncated file of either format', () => {
      const whole = png();
      expect(refusal(whole.subarray(0, whole.length - 5))).toBe('malformed');
      expect(refusal(jpeg({ withoutEoi: true }))).toBe('malformed');
      const cut = jpeg();
      expect(refusal(cut.subarray(0, 30))).toBe('malformed');
    });

    it('refuses a JPEG coded in a way the pipeline does not decode: arithmetic, lossless or hierarchical', () => {
      for (const marker of [0xc3, 0xc5, 0xc9, 0xca, 0xcb, 0xcd]) {
        expect(refusal(jpeg({ sofMarker: marker })), marker.toString(16)).toBe('malformed');
      }
      expect(refusal(jpeg({ precision: 12 }))).toBe('malformed');
      expect(refusal(jpeg({ components: 2 }))).toBe('malformed');
    });

    it('AST-040 refuses more pixels than the limit, read from the header before anything decodes', () => {
      expect(ASSET_MAX_PIXELS).toBe(50_000_000);
      // 7072 by 7071 is 50,006,112: over by a little. 7071 by 7071 is under.
      expect(refusal(png({ width: 7072, height: 7071 }))).toBe('too_many_pixels');
      expect(refusal(jpeg({ width: 7072, height: 7071 }))).toBe('too_many_pixels');
      expect(refusal(png({ width: 7071, height: 7071 }))).toBe('accepted');
    });

    it('AST-040 refuses too many pixels on the header alone, before walking whatever follows it', () => {
      // A bomb is refused by what its header claims, so the service never reads the rest of it.
      const whole = png({ width: 8000, height: 8000 });
      expect(refusal(whole.subarray(0, 33))).toBe('too_many_pixels');
      const photo = jpeg({ width: 8000, height: 8000 });
      expect(refusal(photo.subarray(0, photo.indexOf(0xc4, 90) - 1))).toBe('too_many_pixels');
    });
  });
});
