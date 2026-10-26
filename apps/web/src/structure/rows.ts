import { words } from '../words/words.js';
/** Rows read from text, or why not: what the Generate dialog sends, or says. */
export type ReadRows =
  | {
      readonly ok: true;
      readonly names: readonly string[];
      readonly rows: readonly Readonly<Record<string, string>>[];
    }
  | { readonly ok: false; readonly problem: string };

/**
 * The text's records, each its cells: split on `separator`, and on a line break, outside quotes alone,
 * so a quoted cell keeps its separators, its line breaks, its spaces and its doubled quotes, as a
 * spreadsheet exports one. An unquoted cell is trimmed.
 */
function recordsOf(text: string, separator: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  let wasQuoted = false;
  const endCell = () => {
    record.push(wasQuoted ? cell : cell.trim());
    cell = '';
    wasQuoted = false;
  };
  for (let at = 0; at < text.length; at += 1) {
    const character = text[at]!;
    if (quoted) {
      if (character === '"' && text[at + 1] === '"') {
        cell += '"';
        at += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.trim() === '') {
      quoted = true;
      wasQuoted = true;
      cell = '';
    } else if (character === separator) {
      endCell();
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[at + 1] === '\n') at += 1;
      endCell();
      records.push(record);
      record = [];
    } else {
      cell += character;
    }
  }
  endCell();
  records.push(record);
  return records;
}

/**
 * **Rows from a file or a pasted list** (REU-032; the R7 plan, R7-B): the first line names the
 * parameters, and each line after it is a row, its cells by comma, or by tab where the first line
 * holds one, as a spreadsheet's copy does. An empty cell gives no value; an empty line is no row.
 */
export function rowsFrom(text: string): ReadRows {
  const separator = (text.split(/\r?\n/, 1)[0] ?? '').includes('\t') ? '\t' : ',';
  const records = recordsOf(text, separator);
  const names = records[0] ?? [];
  const blank = (record: readonly string[]) => record.every((cell) => cell === '');
  if (names.length === 0 || blank(names)) {
    return { ok: false, problem: words('document.there-are-no-rows-to') };
  }
  if (names.some((name) => name === '') || new Set(names).size !== names.length) {
    return { ok: false, problem: words('document.the-first-line-names-a') };
  }
  const rows: Record<string, string>[] = [];
  for (let at = 1; at < records.length; at += 1) {
    const cells = records[at]!;
    if (blank(cells)) continue;
    if (cells.length > names.length) {
      return { ok: false, problem: words('document.line-has-more-cells-than', { value1: at + 1 }) };
    }
    rows.push(
      Object.fromEntries(
        cells.flatMap((cell, index) => (cell === '' ? [] : [[names[index]!, cell] as const])),
      ),
    );
  }
  if (rows.length === 0) return { ok: false, problem: words('document.there-are-no-rows-to') };
  return { ok: true, names, rows };
}
