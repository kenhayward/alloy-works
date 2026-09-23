/**
 * What an image says it is, read from its structure and nothing else (docs/design/assets.md, "The two
 * readings"). Pure and platform-free, so the service runs it at the door and the worker's `ingest` job
 * runs it again before it trusts the decode: the two readings must agree.
 *
 * It decodes nothing. It walks a PNG's chunks by their lengths and CRCs to `IEND`, and a JPEG's
 * markers by their lengths, then its entropy-coded data, to `EOI`, and says where the image ends. What
 * follows it - a phone's second picture or motion clip, or a second file hidden in a polyglot, which a
 * decoder does not notice (measured: sharp decodes a PNG with a zip appended and says nothing) - is not
 * the image: the service keeps the bytes up to `end` and no further, and the worker refuses stored
 * bytes that run past it, since by then they can only have been put there some other way.
 */

/** The formats T1 admits (AST-038), and how each is made safe (AST-051): by proof, not by a scan. */
export const ADMITTED_FORMATS = {
  png: { extension: 'png', contentType: 'image/png', madeSafeBy: 'proof' },
  jpeg: { extension: 'jpg', contentType: 'image/jpeg', madeSafeBy: 'proof' },
} as const;

export type AssetFormat = keyof typeof ADMITTED_FORMATS;

/** The largest upload, in bytes, until AST-004 lets a tenant lower it (decision F-E). */
export const ASSET_MAX_BYTES = 25_000_000;

/** The most pixels an image may decode to (AST-040, decision F-E): 200 MB as RGBA. */
export const ASSET_MAX_PIXELS = 50_000_000;

export type ImageColour = 'rgb' | 'grey' | 'cmyk';

/** What the walk reads. The dimensions are as the image is displayed, after its orientation. */
export interface ImageHeader {
  readonly format: AssetFormat;
  readonly width: number;
  readonly height: number;
  /** The EXIF orientation, 1 to 8; 1 where the file carries none. */
  readonly orientation: number;
  readonly colour: ImageColour;
  readonly alpha: boolean;
  readonly depth: 8 | 16;
  /** Dots per inch as the file declares them, to two places, or null where it declares none. */
  readonly resolution: number | null;
  /** How many bytes the image occupies from the start: anything after this is not the image. */
  readonly end: number;
}

/**
 * Why the walk refused. `malformed` carries a detail for a developer reading a test or a log line;
 * no route returns it, because it can quote the file.
 */
export type HeaderRefusal = 'not_permitted' | 'too_many_pixels' | 'malformed';

export type HeaderReading =
  | { readonly ok: true; readonly header: ImageHeader }
  | { readonly ok: false; readonly refusal: HeaderRefusal; readonly detail?: string };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Which admitted format these bytes begin as, or null. The name and a claimed type are never read (AST-002). */
export function admittedFormat(bytes: Uint8Array): AssetFormat | null {
  if (bytes.length >= 8 && PNG_SIGNATURE.every((value, at) => bytes[at] === value)) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'jpeg';
  return null;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 as PNG (and zlib) computes it. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

class Malformed extends Error {}

/** Thrown the moment a header claims more pixels than the limit, so nothing after it is read. */
class TooManyPixels extends Error {}

/** Refuses dimensions over the pixel limit as soon as they are read (AST-040). */
function bounded(width: number, height: number): void {
  if (width * height > ASSET_MAX_PIXELS) throw new TooManyPixels();
}

// A declaration, not an arrow: only a declared `never` function narrows the code after a call to it.
function malformed(detail: string): never {
  throw new Malformed(detail);
}

/** Big-endian reads that refuse to run off the end rather than answering `undefined`. */
const reader = (bytes: Uint8Array) => {
  const need = (at: number, length: number) => {
    if (at < 0 || at + length > bytes.length) malformed(`truncated at ${at}`);
  };
  return {
    u8: (at: number) => (need(at, 1), bytes[at]!),
    u16: (at: number) => (need(at, 2), (bytes[at]! << 8) | bytes[at + 1]!),
    u32: (at: number) => (
      need(at, 4),
      ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0
    ),
    ascii: (at: number, length: number) => (
      need(at, length),
      String.fromCharCode(...bytes.subarray(at, at + length))
    ),
  };
};

const twoPlaces = (value: number) => Math.round(value * 100) / 100;

/** Orientations 5 to 8 turn the image a quarter, so its displayed width is its stored height. */
const displayed = (width: number, height: number, orientation: number) =>
  orientation >= 5 ? { width: height, height: width } : { width, height };

/** Reads what a PNG or a JPEG says it is, or says why it will not. */
export function readImageHeader(bytes: Uint8Array): HeaderReading {
  const format = admittedFormat(bytes);
  if (format === null) return { ok: false, refusal: 'not_permitted' };
  try {
    return { ok: true, header: format === 'png' ? walkPng(bytes) : walkJpeg(bytes) };
  } catch (error) {
    if (error instanceof TooManyPixels) return { ok: false, refusal: 'too_many_pixels' };
    if (error instanceof Malformed)
      return { ok: false, refusal: 'malformed', detail: error.message };
    throw error;
  }
}

/** The bit depths PNG permits for each colour type, and what each means here. */
const PNG_COLOUR: Readonly<
  Record<number, { depths: readonly number[]; colour: ImageColour; alpha: boolean }>
> = {
  0: { depths: [1, 2, 4, 8, 16], colour: 'grey', alpha: false },
  2: { depths: [8, 16], colour: 'rgb', alpha: false },
  3: { depths: [1, 2, 4, 8], colour: 'rgb', alpha: false },
  4: { depths: [8, 16], colour: 'grey', alpha: true },
  6: { depths: [8, 16], colour: 'rgb', alpha: true },
};

const KNOWN_CRITICAL = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);

function walkPng(bytes: Uint8Array): ImageHeader {
  const read = reader(bytes);
  let at = 8;
  let header: Omit<ImageHeader, 'resolution' | 'end'> | undefined;
  let resolution: number | null = null;
  let sawData = false;
  for (;;) {
    const length = read.u32(at);
    const type = read.ascii(at + 4, 4);
    if (!/^[A-Za-z]{4}$/.test(type)) malformed(`chunk type ${JSON.stringify(type)}`);
    const dataAt = at + 8;
    const end = dataAt + length;
    const stored = read.u32(end);
    if (crc32(bytes.subarray(at + 4, end)) !== stored) malformed(`CRC of ${type}`);
    if (header === undefined && type !== 'IHDR') malformed('IHDR is not first');
    // A capital first letter is critical: a decoder must understand it, so the walk must too.
    if (/^[A-Z]/.test(type) && !KNOWN_CRITICAL.has(type)) malformed(`critical chunk ${type}`);
    if (type === 'IHDR') {
      if (header !== undefined || length !== 13) malformed('IHDR');
      const width = read.u32(dataAt);
      const height = read.u32(dataAt + 4);
      const depth = read.u8(dataAt + 8);
      const colourType = read.u8(dataAt + 9);
      const rule = PNG_COLOUR[colourType];
      if (width === 0 || height === 0) malformed('zero dimension');
      bounded(width, height);
      if (rule === undefined || !rule.depths.includes(depth)) malformed('colour type and depth');
      if (read.u8(dataAt + 10) !== 0 || read.u8(dataAt + 11) !== 0 || read.u8(dataAt + 12) > 1) {
        malformed('compression, filter or interlace');
      }
      header = {
        format: 'png',
        width,
        height,
        orientation: 1,
        colour: rule!.colour,
        alpha: rule!.alpha,
        depth: depth === 16 ? 16 : 8,
      };
    } else if (type === 'tRNS') {
      header = { ...header!, alpha: true };
    } else if (type === 'pHYs' && length === 9) {
      const perMetre = read.u32(dataAt);
      // Zero declares nothing, as a JFIF density of zero does.
      if (read.u8(dataAt + 8) === 1 && perMetre > 0) resolution = twoPlaces(perMetre * 0.0254);
    } else if (type === 'acTL') {
      // An animated PNG: animation means nothing on a page, which is why GIF is not admitted either.
      malformed('an animated PNG');
    } else if (type === 'eXIf') {
      // Nobody has measured what the engine does with a PNG's orientation, so one that would turn
      // the image is refused rather than guessed at.
      if (readExif(bytes.subarray(dataAt, end)).orientation !== 1) {
        malformed('a PNG with an EXIF orientation');
      }
    } else if (type === 'IDAT') {
      sawData = true;
    } else if (type === 'IEND') {
      if (length !== 0 || !sawData) malformed('IEND');
      return { ...header!, resolution, end: end + 4 };
    }
    at = end + 4;
  }
}

/**
 * The start-of-frame markers the pipeline decodes: baseline, extended and progressive Huffman. The
 * rest - lossless, hierarchical and arithmetic-coded - are refused, since the engine and the worker's
 * decoder do not agree on them.
 */
const DECODED_FRAMES = new Set([0xc0, 0xc1, 0xc2]);
const REFUSED_FRAMES = new Set([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcc, 0xcd, 0xce, 0xcf]);

function walkJpeg(bytes: Uint8Array): ImageHeader {
  const read = reader(bytes);
  let at = 2;
  let frame: { width: number; height: number; components: number } | undefined;
  let orientation = 1;
  // JFIF's density is preferred where both declare one: it is what JPEG itself defines.
  let jfifResolution: number | null = null;
  let exifResolution: number | null = null;
  for (;;) {
    if (read.u8(at) !== 0xff) malformed(`no marker at ${at}`);
    // Any number of 0xFF may pad before a marker.
    while (read.u8(at + 1) === 0xff) at += 1;
    const marker = read.u8(at + 1);
    at += 2;
    if (marker === 0xd9) {
      if (frame === undefined) malformed('EOI before a frame');
      const turned = displayed(frame.width, frame.height, orientation);
      return {
        format: 'jpeg',
        ...turned,
        orientation,
        colour: frame.components === 1 ? 'grey' : frame.components === 3 ? 'rgb' : 'cmyk',
        alpha: false,
        depth: 8,
        resolution: jfifResolution ?? exifResolution,
        end: at,
      };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      malformed(`standalone marker ${marker.toString(16)} outside a scan`);
    }
    const length = read.u16(at);
    if (length < 2) malformed('segment length');
    const payload = at + 2;
    const end = at + length;
    read.u8(end - 1);
    if (REFUSED_FRAMES.has(marker)) malformed(`frame ${marker.toString(16)}`);
    if (DECODED_FRAMES.has(marker)) {
      if (frame !== undefined) malformed('a second frame');
      if (read.u8(payload) !== 8) malformed('precision');
      const components = read.u8(payload + 5);
      if (![1, 3, 4].includes(components)) malformed('components');
      frame = { height: read.u16(payload + 1), width: read.u16(payload + 3), components };
      if (frame.width === 0 || frame.height === 0) malformed('zero dimension');
      bounded(frame.width, frame.height);
    } else if (marker === 0xe0 && length >= 16 && read.ascii(payload, 5) === 'JFIF\u0000') {
      const units = read.u8(payload + 7);
      const x = read.u16(payload + 8);
      if (units === 1 && x > 0) jfifResolution = x;
      else if (units === 2 && x > 0) jfifResolution = twoPlaces(x * 2.54);
    } else if (marker === 0xe1 && length >= 8 && read.ascii(payload, 6) === 'Exif\u0000\u0000') {
      const exif = readExif(bytes.subarray(payload + 6, end));
      orientation = exif.orientation;
      exifResolution = exif.resolution;
    } else if (marker === 0xda) {
      if (frame === undefined) malformed('a scan before a frame');
      at = entropyEnd(bytes, end);
      continue;
    }
    at = end;
  }
}

/**
 * Where a scan's entropy-coded data ends: at the first 0xFF followed by anything but a stuffed zero or
 * a restart marker. Running off the end of the file is a truncated JPEG.
 */
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
  return malformed('a scan that never ends');
}

/**
 * The orientation (0x0112) and resolution (0x011A with its unit, 0x0128) of a TIFF-structured EXIF
 * block's first directory, each read by the type it declares. Read as the decoder reads them: a block
 * that cannot be walked, or an orientation out of range, is none - 1 - rather than a refusal, because
 * sharp sets such a file upright and so does the engine; the two readings are compared by the worker.
 */
function readExif(tiff: Uint8Array): { orientation: number; resolution: number | null } {
  const none = { orientation: 1, resolution: null };
  const order = String.fromCharCode(tiff[0] ?? 0, tiff[1] ?? 0);
  if (order !== 'II' && order !== 'MM') return none;
  const little = order === 'II';
  const u16 = (at: number) =>
    at + 2 > tiff.length
      ? undefined
      : little
        ? tiff[at]! | (tiff[at + 1]! << 8)
        : (tiff[at]! << 8) | tiff[at + 1]!;
  const u32 = (at: number) =>
    at + 4 > tiff.length
      ? undefined
      : little
        ? (tiff[at]! | (tiff[at + 1]! << 8) | (tiff[at + 2]! << 16) | (tiff[at + 3]! << 24)) >>> 0
        : ((tiff[at]! << 24) | (tiff[at + 1]! << 16) | (tiff[at + 2]! << 8) | tiff[at + 3]!) >>> 0;
  if (u16(2) !== 42) return none;
  const directory = u32(4);
  const entries = directory === undefined ? undefined : u16(directory);
  if (directory === undefined || entries === undefined) return none;
  /** A SHORT or a LONG value held in its entry, or undefined. */
  const integer = (at: number) => {
    const type = u16(at + 2);
    return type === 3 ? u16(at + 8) : type === 4 ? u32(at + 8) : undefined;
  };
  /** A RATIONAL at the offset its entry holds, or undefined. */
  const rational = (at: number) => {
    const offset = u16(at + 2) === 5 ? u32(at + 8) : undefined;
    if (offset === undefined) return undefined;
    const numerator = u32(offset);
    const denominator = u32(offset + 4);
    return numerator === undefined || !denominator ? undefined : numerator / denominator;
  };
  let orientation = 1;
  let perUnit: number | undefined;
  let unit = 2;
  for (let entry = 0; entry < entries; entry += 1) {
    const at = directory + 2 + entry * 12;
    const tag = u16(at);
    if (tag === undefined) break;
    if (tag === 0x0112) {
      const value = integer(at);
      orientation = value !== undefined && value >= 1 && value <= 8 ? value : 1;
    } else if (tag === 0x011a) {
      perUnit = rational(at);
    } else if (tag === 0x0128) {
      unit = integer(at) ?? 2;
    }
  }
  // TIFF's unit: 2 is inches, and the default; 3 is centimetres; 1 declares no absolute unit.
  const resolution =
    perUnit === undefined || perUnit <= 0 || unit === 1
      ? null
      : twoPlaces(unit === 3 ? perUnit * 2.54 : perUnit);
  return { orientation, resolution };
}
