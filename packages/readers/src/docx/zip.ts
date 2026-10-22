import { Unzip, UnzipInflate, type UnzipFile } from 'fflate';

const MB = 1024 * 1024;

/**
 * What a zip may hold before it is refused (the IM plan, IM-C): entries counted, and the bytes of the
 * parts read counted as they inflate, never trusting the sizes the zip declares.
 */
export const ZIP_CAPS = { entries: 1000, inflated: 200 * MB, part: 20 * MB } as const;

export type ZipCaps = {
  readonly entries: number;
  readonly inflated: number;
  readonly part: number;
};

export type ZipRefusal = 'entryName' | 'entries' | 'inflated' | 'unreadable';

export type ZipRead =
  | {
      readonly ok: true;
      /** Every entry's name, as the zip spells it, in the order it holds them. */
      readonly names: readonly string[];
      /** The parts asked for, by their name in lower case: a package's part names ignore case. */
      readonly parts: ReadonlyMap<string, Uint8Array>;
    }
  | { readonly ok: false; readonly refusal: ZipRefusal; readonly failure: string };

/** Pushed this much at a time, so one push inflates at most about a thousand times as much. */
const CHUNK = 8 * 1024;

/** A name that climbs out, is absolute, uses a backslash or a drive, or holds a control or an empty segment. */
function unsafe(name: string): boolean {
  if (name.length === 0 || name.length > 1024) return true;
  if (name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return true;
  if ([...name].some((character) => character.charCodeAt(0) < 0x20)) return true;
  const segments = name.endsWith('/') ? name.slice(0, -1).split('/') : name.split('/');
  return segments.some((segment) => segment === '' || segment === '.' || segment === '..');
}

class Refused extends Error {
  constructor(
    readonly refusal: ZipRefusal,
    message: string,
  ) {
    super(message);
  }
}

/**
 * A zip read in memory, guarded (IM-C): every entry's name checked, at most `entries` of them, and
 * only the parts `wanted` names inflated, each counted as it streams against `part` and all of them
 * against `inflated`, aborting past either. Nothing is written anywhere.
 */
export function readZip(
  bytes: Uint8Array,
  wanted: (name: string) => boolean,
  caps: ZipCaps = ZIP_CAPS,
): ZipRead {
  const names: string[] = [];
  const seen = new Set<string>();
  const parts = new Map<string, Uint8Array>();
  const open = new Set<string>();
  let inflated = 0;
  let stop: Refused | undefined;

  const onFile = (file: UnzipFile) => {
    if (stop) return;
    const lower = file.name.toLowerCase();
    if (unsafe(file.name) || seen.has(lower)) {
      stop = new Refused('entryName', 'An entry in the zip has a name that is not allowed');
      return;
    }
    seen.add(lower);
    names.push(file.name);
    if (names.length > caps.entries) {
      stop = new Refused('entries', `The zip holds more than ${caps.entries} entries`);
      return;
    }
    if (file.name.endsWith('/') || !wanted(file.name)) return;
    const chunks: Uint8Array[] = [];
    let size = 0;
    open.add(lower);
    file.ondata = (error, data, final) => {
      if (stop) return;
      if (error) {
        stop = new Refused('unreadable', 'A part of the zip does not inflate');
        return;
      }
      size += data.length;
      inflated += data.length;
      if (size > caps.part || inflated > caps.inflated) {
        stop = new Refused('inflated', 'The zip inflates to more than may be read');
        file.terminate();
        return;
      }
      chunks.push(data);
      if (final) {
        open.delete(lower);
        const whole = new Uint8Array(size);
        let at = 0;
        for (const chunk of chunks) {
          whole.set(chunk, at);
          at += chunk.length;
        }
        parts.set(lower, whole);
      }
    };
    try {
      file.start();
    } catch {
      stop = new Refused('unreadable', 'A part of the zip is compressed in a way that is not read');
    }
  };

  try {
    const unzip = new Unzip(onFile);
    unzip.register(UnzipInflate);
    for (let at = 0; at < bytes.length && !stop; at += CHUNK) {
      const end = Math.min(at + CHUNK, bytes.length);
      unzip.push(bytes.subarray(at, end), end === bytes.length);
    }
  } catch (error) {
    stop ??= new Refused('unreadable', error instanceof Error ? error.message : String(error));
  }
  if (stop) return { ok: false, refusal: stop.refusal, failure: stop.message };
  if (names.length === 0) return { ok: false, refusal: 'unreadable', failure: 'Not a zip' };
  if (open.size > 0) {
    return { ok: false, refusal: 'unreadable', failure: 'A part of the zip is cut short' };
  }
  return { ok: true, names, parts };
}
