/** Rows read from text, or why not: what the Generate dialog sends, or says. */
export type ReadRows =
  | {
      readonly ok: true;
      readonly names: readonly string[];
      readonly rows: readonly Readonly<Record<string, string>>[];
    }
  | { readonly ok: false; readonly problem: string };

/** One line's cells, split on `separator`, a quoted cell holding separators and doubled quotes. */
function cellsOf(line: string, separator: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let at = 0; at < line.length; at += 1) {
    const character = line[at]!;
    if (quoted) {
      if (character === '"' && line[at + 1] === '"') {
        cell += '"';
        at += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell === '') {
      quoted = true;
    } else if (character === separator) {
      cells.push(cell);
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell);
  return cells.map((each) => each.trim());
}

/**
 * **Rows from a file or a pasted list** (REU-032; the R7 plan, R7-B): the first line names the
 * parameters, and each line after it is a row, its cells by comma, or by tab where the first line
 * holds one, as a spreadsheet's copy does. An empty cell gives no value; an empty line is no row.
 */
export function rowsFrom(text: string): ReadRows {
  const lines = text.split(/\r?\n/);
  const header = lines[0] ?? '';
  const separator = header.includes('\t') ? '\t' : ',';
  const names = cellsOf(header, separator);
  if (names.length === 0 || names.every((name) => name === '')) {
    return { ok: false, problem: 'There are no rows to read.' };
  }
  if (names.some((name) => name === '') || new Set(names).size !== names.length) {
    return { ok: false, problem: 'The first line names a parameter twice, or leaves one unnamed.' };
  }
  const rows: Record<string, string>[] = [];
  for (let at = 1; at < lines.length; at += 1) {
    const line = lines[at]!;
    if (line.trim() === '') continue;
    const cells = cellsOf(line, separator);
    if (cells.length > names.length) {
      return { ok: false, problem: `Line ${at + 1} has more cells than the first line names.` };
    }
    rows.push(
      Object.fromEntries(
        cells.flatMap((cell, index) => (cell === '' ? [] : [[names[index]!, cell] as const])),
      ),
    );
  }
  if (rows.length === 0) return { ok: false, problem: 'There are no rows to read.' };
  return { ok: true, names, rows };
}
