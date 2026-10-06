import { dataFailure, type DataFailure, type DataFormat } from '@alloy-works/domain';
import { SaxesParser, type SaxesTagPlain } from 'saxes';

import { inflateEntry, readZip, Stopped, type Budget, type ZipEntry } from './zip.js';

/**
 * XLSX read in the child by the product's own reader (data.md, "The fetch"; ADR-0035; the D6 plan,
 * D6-I), over `zip.ts` and `saxes`: the package's relationships to the workbook, its date system and
 * its sheets, the shared strings, and the one declared sheet streamed a row at a time and let go. A
 * cell is read as the file stores it - a number by the text of its `<v>`, never a double; a shared
 * or inline string; a boolean; an error; a formula's cached value, or none - and its declared type
 * decides what it means (`serial.ts`). Every part is inflated into one budget; any `DOCTYPE` is
 * refused, so no entity is ever declared, let alone expanded. A workbook that is not one, a sheet that
 * is not there, rows or cells out of order are `result_mismatch`.
 */

export type XlsxFormat = Extract<DataFormat, { kind: 'xlsx' }>;

/** A cell as the sheet stores it; `dated` where its style's number format is a date's. */
export type XlsxCell =
  | null
  | { readonly kind: 'string'; readonly text: string }
  | { readonly kind: 'number'; readonly text: string; readonly dated: boolean }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'error' };

/** What a visitor answers of a row: nothing where it took it, or the failure that stops the read. */
export type RowVisitor = (
  row: readonly XlsxCell[],
  index: number,
  date1904: boolean,
) => DataFailure | undefined;

/** The most columns and rows a sheet holds, as Excel's grid does. */
const MAX_COLUMN = 16_383;
const MAX_ROW = 1_048_576;

const mismatch = () => new Stopped(dataFailure('result_mismatch'));

/** A name without its prefix: writers may prefix SpreadsheetML's elements. */
const local = (name: string) => name.slice(name.indexOf(':') + 1);

/** An attribute by its local name, whatever prefix it carries. */
function attribute(tag: SaxesTagPlain, name: string, prefixed = false): string | undefined {
  for (const [key, value] of Object.entries(tag.attributes)) {
    const colon = key.indexOf(':');
    if (colon >= 0 === prefixed && key.slice(colon + 1) === name) return value;
  }
  return undefined;
}

interface Handlers {
  open?(name: string, tag: SaxesTagPlain): void;
  close?(name: string): void;
  text?(text: string): void;
}

/** A parser that refuses any document type declaration, and whose every error is the workbook's. */
function parser(handlers: Handlers): SaxesParser {
  const parse = new SaxesParser({ position: false });
  parse.on('doctype', () => {
    throw mismatch();
  });
  parse.on('error', () => {
    throw mismatch();
  });
  if (handlers.open) {
    const open = handlers.open;
    parse.on('opentag', (tag) => open(local(tag.name), tag as SaxesTagPlain));
  }
  if (handlers.close) parse.on('closetag', (tag) => handlers.close!(local(tag.name)));
  if (handlers.text) {
    const text = handlers.text;
    parse.on('text', text);
    parse.on('cdata', text);
  }
  return parse;
}

/** An entry's XML, inflated into the budget and parsed as it inflates. */
function parsePart(body: Buffer, entry: ZipEntry, budget: Budget, handlers: Handlers): void {
  const parse = parser(handlers);
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  try {
    inflateEntry(body, entry, budget, (chunk, final) => {
      parse.write(decoder.decode(chunk, { stream: !final }));
    });
    parse.close();
  } catch (error) {
    if (error instanceof Stopped) throw error;
    // Text that is not UTF-8.
    throw mismatch();
  }
}

/** A part's path from a relationship's target, relative to the part that names it. */
function resolve(from: string, target: string): string {
  const parts = target.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const segment of target.replace(/^\//, '').split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.' && segment !== '') parts.push(segment);
  }
  return parts.join('/');
}

/** The relationships part beside a part: `xl/workbook.xml`'s is `xl/_rels/workbook.xml.rels`. */
const relsOf = (part: string) => {
  const slash = part.lastIndexOf('/');
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
};

/** A part's relationships: each by its id, its type's last segment and its resolved target. */
function relationships(
  body: Buffer,
  entries: ReadonlyMap<string, ZipEntry>,
  budget: Budget,
  part: string,
): { readonly id: string; readonly type: string; readonly target: string }[] {
  const entry = entries.get(relsOf(part).toLowerCase());
  if (entry === undefined) throw mismatch();
  const found: { id: string; type: string; target: string }[] = [];
  parsePart(body, entry, budget, {
    open: (name, tag) => {
      if (name !== 'Relationship') return;
      const id = attribute(tag, 'Id');
      const type = attribute(tag, 'Type');
      const target = attribute(tag, 'Target');
      // An external target is no part of this package.
      if (id === undefined || type === undefined || target === undefined) throw mismatch();
      if (attribute(tag, 'TargetMode') === 'External') return;
      found.push({
        id,
        type: type.slice(type.lastIndexOf('/') + 1),
        target: resolve(part, target),
      });
    },
  });
  return found;
}

/** The number formats that are a date's or a time's: built-in 14 to 22 and 45 to 47, or by code. */
function datedFormat(id: number, code: string | undefined): boolean {
  if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47)) return true;
  if (code === undefined) return false;
  // A code's letters outside quotes, escapes and brackets: a date's or a time's are y, m, d, h or s.
  const bare = code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
  return /[ymdhs]/i.test(bare);
}

/** What a workbook's parts come to before its sheet is read. */
interface Workbook {
  readonly body: Buffer;
  readonly entries: ReadonlyMap<string, ZipEntry>;
  readonly budget: Budget;
  readonly date1904: boolean;
  readonly shared: readonly string[];
  readonly dated: readonly boolean[];
  readonly sheet: ZipEntry;
}

/** The workbook's date system, its shared strings and the declared sheet's entry. Throws `Stopped`. */
function openWorkbook(
  body: Buffer,
  format: XlsxFormat,
  maxBytes: number,
  styles: boolean,
): Workbook {
  const zip = readZip(body);
  if ('failure' in zip) throw new Stopped(zip.failure);
  const { entries } = zip;
  const budget: Budget = { left: maxBytes };
  const entry = (path: string) => {
    const found = entries.get(path.toLowerCase());
    if (found === undefined) throw mismatch();
    return found;
  };

  const office = relationships(body, entries, budget, '').find(
    (each) => each.type === 'officeDocument',
  );
  if (office === undefined) throw mismatch();
  const workbookPath = office.target;

  let date1904 = false;
  const sheets = new Map<string, string>();
  parsePart(body, entry(workbookPath), budget, {
    open: (name, tag) => {
      if (name === 'workbookPr') {
        const value = attribute(tag, 'date1904');
        date1904 = value === '1' || value === 'true';
      } else if (name === 'sheet') {
        const sheetName = attribute(tag, 'name');
        const id = attribute(tag, 'id', true);
        if (sheetName === undefined || id === undefined) throw mismatch();
        sheets.set(sheetName, id);
      }
    },
  });
  const related = relationships(body, entries, budget, workbookPath);
  const id = sheets.get(format.sheet);
  const sheetPath = related.find((each) => each.id === id && each.type === 'worksheet')?.target;
  if (sheetPath === undefined) throw mismatch();

  // Shared strings, each its runs' text, a phonetic run (`rPh`) left out.
  const shared: string[] = [];
  const strings = related.find((each) => each.type === 'sharedStrings');
  if (strings !== undefined) {
    let item: string | null = null;
    let inText = false;
    let phonetic = 0;
    parsePart(body, entry(strings.target), budget, {
      open: (name) => {
        if (name === 'si') item = '';
        else if (name === 'rPh') phonetic += 1;
        else if (name === 't') inText = true;
      },
      close: (name) => {
        if (name === 'si') {
          shared.push(item ?? '');
          item = null;
        } else if (name === 'rPh') phonetic -= 1;
        else if (name === 't') inText = false;
      },
      text: (text) => {
        if (item !== null && inText && phonetic === 0) item += text;
      },
    });
  }

  // Styles, read only to propose a date column from a date's number format (the D6 plan, task 3).
  const dated: boolean[] = [];
  const style = related.find((each) => each.type === 'styles');
  if (styles && style !== undefined) {
    const codes = new Map<number, string>();
    let inCellStyles = false;
    parsePart(body, entry(style.target), budget, {
      open: (name, tag) => {
        if (name === 'numFmt') {
          codes.set(Number(attribute(tag, 'numFmtId')), attribute(tag, 'formatCode') ?? '');
        } else if (name === 'cellXfs') inCellStyles = true;
        else if (name === 'xf' && inCellStyles) {
          const formatId = Number(attribute(tag, 'numFmtId') ?? '0');
          dated.push(datedFormat(formatId, codes.get(formatId)));
        }
      },
      close: (name) => {
        if (name === 'cellXfs') inCellStyles = false;
      },
    });
  }
  return { body, entries, budget, date1904, shared, dated, sheet: entry(sheetPath) };
}

/** A cell's reference, `B12`, as its column's index and its row's number. */
const REFERENCE = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/;

function columnOf(letters: string): number {
  let index = 0;
  for (const character of letters) index = index * 26 + (character.charCodeAt(0) - 64);
  return index - 1;
}

/**
 * Each row the declared sheet holds, in order: the header first where the format says the first row
 * is one, then each data row counted from 0. A row with no value in it is no row, as an empty line is
 * no CSV record. Rows and the cells in a row are strictly ascending, or the sheet is
 * `result_mismatch`. A formula with no cached value, or an error, is a cell of kind `error`.
 */
export function eachSheetRow(
  body: Buffer,
  format: XlsxFormat,
  maxBytes: number,
  visit: RowVisitor,
  header?: (names: readonly XlsxCell[]) => DataFailure | undefined,
  styles = false,
): { readonly rows: number } | { readonly failure: DataFailure } {
  let rows = 0;
  try {
    const book = openWorkbook(body, format, maxBytes, styles);
    let headed = !format.headerRow;
    let inData = false;
    let lastRow = 0;
    let cells: XlsxCell[] | null = null;
    let lastColumn = -1;
    let valued = false;
    // The cell being read.
    let type = 'n';
    let style = 0;
    let at = -1;
    let value: string | null = null;
    let inline: string | null = null;
    let formula = false;
    let field: 'v' | 't' | null = null;
    let inInline = false;
    let phonetic = 0;

    const endCell = (): XlsxCell => {
      if (type === 'e') return { kind: 'error' };
      // A formula is read by its cached value; without one, it is read as an error (`cell_error`).
      if (formula && value === null && type !== 'inlineStr') return { kind: 'error' };
      switch (type) {
        case 's': {
          const index = Number(value);
          if (value === null || !/^[0-9]+$/.test(value.trim()) || index >= book.shared.length) {
            throw mismatch();
          }
          return { kind: 'string', text: book.shared[index]! };
        }
        case 'inlineStr':
          return { kind: 'string', text: inline ?? '' };
        case 'str':
        case 'd':
          return { kind: 'string', text: value ?? '' };
        case 'b':
          if (value === '1' || value === '0') return { kind: 'boolean', value: value === '1' };
          throw mismatch();
        case 'n':
          return value === null
            ? null
            : { kind: 'number', text: value.trim(), dated: book.dated[style] ?? false };
        default:
          throw mismatch();
      }
    };

    parsePart(book.body, book.sheet, book.budget, {
      open: (name, tag) => {
        if (name === 'sheetData') {
          inData = true;
          return;
        }
        if (!inData) return;
        if (name === 'row') {
          const stated = attribute(tag, 'r');
          const number = stated === undefined ? lastRow + 1 : Number(stated);
          if (!Number.isSafeInteger(number) || number <= lastRow || number > MAX_ROW) {
            throw mismatch();
          }
          lastRow = number;
          cells = [];
          lastColumn = -1;
          valued = false;
        } else if (name === 'c') {
          if (cells === null) throw mismatch();
          const reference = attribute(tag, 'r');
          if (reference === undefined) {
            at = lastColumn + 1;
          } else {
            const match = REFERENCE.exec(reference);
            if (!match || Number(match[2]) !== lastRow) throw mismatch();
            at = columnOf(match[1]!);
          }
          if (at <= lastColumn || at > MAX_COLUMN) throw mismatch();
          lastColumn = at;
          type = attribute(tag, 't') ?? 'n';
          style = Number(attribute(tag, 's') ?? '0');
          value = null;
          inline = null;
          formula = false;
        } else if (name === 'v') {
          field = 'v';
          value = '';
        } else if (name === 'f') {
          formula = true;
        } else if (name === 'is') {
          inInline = true;
          inline = '';
        } else if (name === 'rPh') {
          phonetic += 1;
        } else if (name === 't' && inInline && phonetic === 0) {
          field = 't';
        }
      },
      close: (name) => {
        if (name === 'sheetData') inData = false;
        if (!inData) return;
        if (name === 'v' || name === 't') field = null;
        else if (name === 'is') inInline = false;
        else if (name === 'rPh') phonetic -= 1;
        else if (name === 'c') {
          const read = endCell();
          if (read !== null) {
            while (cells!.length < at) cells!.push(null);
            cells![at] = read;
            valued = true;
          }
        } else if (name === 'row') {
          const done = cells!;
          cells = null;
          if (!valued) return;
          if (!headed) {
            headed = true;
            const refused = header?.(done);
            if (refused !== undefined) throw new Stopped(refused);
            return;
          }
          const refused = visit(done, rows, book.date1904);
          if (refused !== undefined) throw new Stopped(refused);
          rows += 1;
        }
      },
      text: (text) => {
        if (field === 'v') value += text;
        else if (field === 't') inline += text;
      },
    });
  } catch (error) {
    if (error instanceof Stopped) return { failure: error.failure };
    throw error;
  }
  return { rows };
}
