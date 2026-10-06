import {
  dataFailure,
  isJsonObject,
  JsonNumber,
  resolvePointer,
  type DataFailure,
  type DataFormat,
  type JsonValue,
} from '@alloy-works/domain';

/**
 * JSON and JSON Lines read in the child (data.md, "The fetch"; DAT-095; the D6 plan, D6-H): by
 * `JSON.parse` with its reviver's `context.source`, so every number is kept as the text it was written
 * with, after a scan that refuses nesting deeper than 64 - the reviver recurses, and a hostile body
 * must not take the child's stack. JSON Lines a line at a time.
 */

/** The JSON formats: at a pointer, or a line at a time. */
export type JsonFormat = Extract<DataFormat, { kind: 'json' | 'jsonLines' }>;

/** The deepest a JSON value may nest. */
export const MAX_JSON_DEPTH = 64;

/** Whether text nests no deeper than the bound, its brackets counted outside strings. */
export function withinDepth(text: string, bound = MAX_JSON_DEPTH): boolean {
  let depth = 0;
  let inString = false;
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    if (inString) {
      if (code === 92) at += 1;
      else if (code === 34) inString = false;
      continue;
    }
    if (code === 34) inString = true;
    else if (code === 91 || code === 123) {
      depth += 1;
      if (depth > bound) return false;
    } else if (code === 93 || code === 125) depth -= 1;
  }
  return true;
}

/** The reviver's third argument, which Node 21 and later pass (TC39's JSON.parse source text access). */
interface ReviverContext {
  readonly source?: string;
}

/** A number as its source text; without it a number would be a double, which DAT-095 forbids. */
function bySource(this: unknown, _key: string, value: unknown, context?: ReviverContext): unknown {
  if (typeof value !== 'number') return value;
  if (context?.source === undefined) throw new Error('No source text');
  return new JsonNumber(context.source);
}

/** JSON text parsed, each number its source text; undefined where it is not JSON or nests too deep. */
export function parseJson(text: string): JsonValue | undefined {
  if (!withinDepth(text)) return undefined;
  try {
    return JSON.parse(text, bySource as (key: string, value: unknown) => unknown) as JsonValue;
  } catch {
    return undefined;
  }
}

/** A body's bytes as text: UTF-8 exactly, a leading byte order mark dropped. */
export function bodyText(body: Buffer): string | undefined {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    return undefined;
  }
}

/** A row read, as a visitor is handed it. */
export type JsonRow = { readonly [name: string]: JsonValue };

/** What a visitor answers of a row: nothing where it took it, or the failure that stops the read. */
export type RowVisitor = (row: JsonRow, index: number) => DataFailure | undefined;

/** What a read came to: the rows visited and the count the body states, or why it stopped. */
export type Visited =
  | { readonly rows: number; readonly count?: JsonValue | undefined }
  | { readonly failure: DataFailure };

const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;

/**
 * Each row a body holds by its format, handed to a visitor in order and let go once visited, so a
 * body's rows are never held whole beside what is made of them (the D6 plan's measurement): JSON's
 * array of objects at its pointer, with the count it states at its own; or JSON Lines, an object a
 * line, each line decoded and parsed alone, an empty line skipped. Text that is not UTF-8 or not
 * JSON, a pointer naming no array, or an item that is not an object is `result_mismatch`, naming the
 * row where it names one.
 */
export function eachRow(body: Buffer, format: JsonFormat, visit: RowVisitor): Visited {
  const mismatch = (row?: number): Visited => ({
    failure: dataFailure('result_mismatch', row === undefined ? {} : { row }),
  });
  if (format.kind === 'jsonLines') {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let rows = 0;
    let from = body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf ? 3 : 0;
    while (from < body.length) {
      const found = body.indexOf(LINE_FEED, from);
      let end = found < 0 ? body.length : found;
      const next = found < 0 ? body.length : found + 1;
      if (end > from && body[end - 1] === CARRIAGE_RETURN) end -= 1;
      let line: string;
      try {
        line = decoder.decode(body.subarray(from, end));
      } catch {
        return mismatch(rows + 1);
      }
      from = next;
      if (line.trim() === '') continue;
      const value = parseJson(line);
      if (value === undefined || !isJsonObject(value)) return mismatch(rows + 1);
      const refused = visit(value, rows);
      if (refused !== undefined) return { failure: refused };
      rows += 1;
    }
    return { rows };
  }
  const text = bodyText(body);
  if (text === undefined) return mismatch();
  const value = parseJson(text);
  if (value === undefined) return mismatch();
  const found = resolvePointer(value, format.rows);
  if (found === undefined || !Array.isArray(found)) return mismatch();
  const items = found as (JsonValue | null)[];
  const count = format.count === undefined ? undefined : resolvePointer(value, format.count);
  for (let at = 0; at < items.length; at += 1) {
    const item = items[at]!;
    if (!isJsonObject(item)) return mismatch(at + 1);
    const refused = visit(item, at);
    if (refused !== undefined) return { failure: refused };
    // Let go once visited.
    items[at] = null;
  }
  return { rows: items.length, ...(format.count === undefined ? {} : { count }) };
}

/** The first rows a body holds, up to `most`, kept: what a sample proposes its columns from. */
export function firstRows(
  body: Buffer,
  format: JsonFormat,
  most: number,
):
  | { readonly rows: JsonRow[]; readonly count?: JsonValue | undefined }
  | { readonly failure: DataFailure } {
  const rows: JsonRow[] = [];
  const visited = eachRow(body, format, (row) => {
    if (rows.length < most) rows.push(row);
    return undefined;
  });
  return 'failure' in visited ? visited : { rows, count: visited.count };
}

/**
 * Whether a stated count agrees with the rows read (DAT-108): a JSON integer equal to their number.
 * A count that names nothing, or is not an integer, disagrees.
 */
export function countAgrees(count: JsonValue | undefined, rows: number): boolean {
  return count instanceof JsonNumber && /^(?:0|[1-9][0-9]*)$/.test(count.source)
    ? Number(count.source) === rows
    : false;
}
