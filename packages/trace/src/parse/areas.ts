import { tableCells } from './table.js';

/** One row of the areas index: a three-letter code and the area's name. */
export interface AreaIndexEntry {
  code: string;
  name: string;
}

/**
 * The areas index in `docs/specification/requirements/README.md`, in the order it lists them - the
 * order the scope introduces the areas in, which is the order a reader of the whole corpus expects.
 *
 * A row is an area row when its first cell is a bolded three-letter code and nothing more. That is
 * what keeps the ownership table's `**Component**` and any requirement row's `**ZZZ-001**` out of it,
 * without the parser having to know which heading the index sits under.
 */
export function parseAreaIndex(text: string): AreaIndexEntry[] {
  const entries: AreaIndexEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = tableCells(line);
    if (cells === undefined || cells.length < 2) continue;
    const code = /^\*\*([A-Z]{3})\*\*$/.exec(cells[0]!)?.[1];
    if (code === undefined) continue;
    entries.push({ code, name: cells[1]! });
  }
  return entries;
}
