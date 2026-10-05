import { crc32 } from 'node:zlib';

/**
 * Tiny invented images, built byte by byte as the domain's header tests build theirs: nothing is read
 * from disk, and nothing here is a real picture. The walk reads structure, so this is all it needs.
 */

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];
const ascii = (text: string) => [...text].map((each) => each.charCodeAt(0));

const chunk = (type: string, data: number[] = []) => {
  const body = Uint8Array.from([...ascii(type), ...data]);
  return [...u32(data.length), ...body, ...u32(crc32(body))];
};

/** A PNG of these dimensions, its data a few invented bytes, and anything after it. */
export function png(options: { width?: number; height?: number; after?: number[] } = {}): Buffer {
  return Buffer.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', [...u32(options.width ?? 4), ...u32(options.height ?? 3), 8, 2, 0, 0, 0]),
    ...chunk('IDAT', [0x78, 0x9c, 1, 2, 3]),
    ...chunk('IEND'),
    ...(options.after ?? []),
  ]);
}

const segment = (marker: number, payload: number[]) => [
  0xff,
  marker,
  ...u16(payload.length + 2),
  ...payload,
];

/** A baseline JPEG of these dimensions, its scan a few invented bytes, and anything after it. */
export function jpeg(options: { width?: number; height?: number; after?: number[] } = {}): Buffer {
  return Buffer.from([
    0xff,
    0xd8,
    ...segment(0xdb, [0, ...Array<number>(64).fill(1)]),
    ...segment(0xc0, [
      8,
      ...u16(options.height ?? 3),
      ...u16(options.width ?? 4),
      3,
      ...[1, 2, 3].flatMap((id) => [id, 0x11, 0]),
    ]),
    ...segment(0xc4, [0, ...Array<number>(16).fill(0)]),
    ...segment(0xda, [3, 1, 0, 2, 0, 3, 0, 0, 63, 0]),
    0x12,
    0x34,
    0xff,
    0x00,
    0x56,
    0xff,
    0xd9,
    ...(options.after ?? []),
  ]);
}

/** A GIF's signature and a little more: a format the door does not admit. */
export const gif = (): Buffer => Buffer.from([...ascii('GIF89a'), 1, 0, 1, 0, 0, 0, 0, 0x3b]);
