import { crc32 } from './header.js';

// PNGs and JPEGs built byte by byte, so a test says exactly what it is shown (figures 1, R5). Shared by
// the header walk's tests and the strip's.

export const bytes = (...parts: (number[] | Uint8Array | string)[]): Uint8Array => {
  const flat: number[] = [];
  for (const part of parts) {
    if (typeof part === 'string') for (const c of part) flat.push(c.charCodeAt(0));
    else flat.push(...part);
  }
  return Uint8Array.from(flat);
};
export const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
export const u16 = (n: number) => [(n >>> 8) & 255, n & 255];

export const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const chunk = (type: string, data: number[] = [], crcFix = 0) => {
  const body = bytes(type, data);
  return [...u32(data.length), ...body, ...u32((crc32(body) ^ crcFix) >>> 0)];
};
export const ihdr = (width: number, height: number, depth = 8, colourType = 2, interlace = 0) =>
  chunk('IHDR', [...u32(width), ...u32(height), depth, colourType, 0, 0, interlace]);

export interface PngOptions {
  width?: number;
  height?: number;
  depth?: number;
  colourType?: number;
  extra?: number[][];
  after?: number[];
  withoutIdat?: boolean;
}
export const png = (options: PngOptions = {}) =>
  bytes(
    SIGNATURE,
    ihdr(options.width ?? 800, options.height ?? 500, options.depth, options.colourType),
    ...(options.colourType === 3 ? [chunk('PLTE', [0, 0, 0, 255, 255, 255])] : []),
    ...(options.extra ?? []),
    ...(options.withoutIdat ? [] : [chunk('IDAT', [0x78, 0x9c, 1, 2, 3])]),
    chunk('IEND'),
    options.after ?? [],
  );

export const segment = (marker: number, payload: number[]) => [
  0xff,
  marker,
  ...u16(payload.length + 2),
  ...payload,
];
export const sof = (
  marker: number,
  width: number,
  height: number,
  components: number,
  precision = 8,
) =>
  segment(marker, [
    precision,
    ...u16(height),
    ...u16(width),
    components,
    ...Array.from({ length: components }, (_, at) => [at + 1, 0x11, 0]).flat(),
  ]);
export const jfif = (units: number, x: number, y: number) =>
  segment(0xe0, [...bytes('JFIF'), 0, 1, 2, units, ...u16(x), ...u16(y), 0, 0]);
/** An EXIF block in big-endian TIFF order with IFD0 holding the entries given, each a SHORT. */
export const exif = (entries: [tag: number, value: number][]) => {
  const ifd = [
    ...u16(entries.length),
    ...entries.flatMap(([tag, value]) => [...u16(tag), ...u16(3), ...u32(1), ...u16(value), 0, 0]),
    ...u32(0),
  ];
  return segment(0xe1, [...bytes('Exif'), 0, 0, ...bytes('MM'), 0, 42, ...u32(8), ...ifd]);
};
/** A big-endian TIFF block whose first directory holds these entries: SHORT, LONG or RATIONAL. */
export const tiff = (
  entries: { tag: number; type: 3 | 4 | 5; value: number | [number, number] }[],
) => {
  const dataAt = 8 + 2 + entries.length * 12 + 4;
  const data: number[] = [];
  const directory = entries.flatMap(({ tag, type, value }) => {
    if (type === 5) {
      const [numerator, denominator] = value as [number, number];
      const offset = dataAt + data.length;
      data.push(...u32(numerator), ...u32(denominator));
      return [...u16(tag), ...u16(5), ...u32(1), ...u32(offset)];
    }
    const field = type === 3 ? [...u16(value as number), 0, 0] : u32(value as number);
    return [...u16(tag), ...u16(type), ...u32(1), ...field];
  });
  return [
    ...bytes('MM'),
    0,
    42,
    ...u32(8),
    ...u16(entries.length),
    ...directory,
    ...u32(0),
    ...data,
  ];
};
export const exifBlock = (entries: Parameters<typeof tiff>[0]) =>
  segment(0xe1, [...bytes('Exif'), 0, 0, ...tiff(entries)]);
export const adobe = () => segment(0xee, [...bytes('Adobe'), 0, 100, 0, 0, 0, 0, 2]);
export const sos = (components: number) =>
  segment(0xda, [
    components,
    ...Array.from({ length: components }, (_, at) => [at + 1, 0]).flat(),
    0,
    63,
    0,
  ]);
/** Entropy-coded data carrying a stuffed 0xFF and a restart marker, which the walk must pass over. */
export const SCAN = [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0x9a];

export interface JpegOptions {
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
export const jpeg = (options: JpegOptions = {}) => {
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
