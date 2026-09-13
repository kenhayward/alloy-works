import { Baseline, Exclusion, Inclusion, Verification, validate } from '../model.js';
import { boldIdentifier, tableCells } from './table.js';

/** The heading line: `# <version>`, not `## <section>` - the leading `#` must stand alone. */
const HEADING = /^#\s+(.+?)\s*$/;

/** The banner: `> **Declared:** YYYY-MM-DD. <what this release is answerable for>`. */
const DECLARED = /^>\s*\*\*Declared:\*\*\s*(\d{4}-\d{2}-\d{2})\./;

/**
 * One `##` section's rows, each with a bolded identifier in its first cell. Stops at the next
 * heading, the same boundary `parse/design.ts` uses for `## Requirements owned` - a table under an
 * unrelated heading later in the document is never read into this section.
 */
function readSection<T>(
  lines: string[],
  document: string,
  heading: string,
  noun: string,
  expectedCells: number,
  build: (id: string, cells: string[], where: string) => T,
): T[] {
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return [];

  const rows: T[] = [];
  // Where each identifier was first declared in this section, so a second row for the same
  // identifier is refused at parse time rather than silently overriding the first - a baseline
  // declaring the same identifier twice in one section is a malformed document, not something a
  // later stage should have to notice and resolve.
  const firstSeenAt = new Map<string, string>();
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.startsWith('## ')) break;

    const cells = tableCells(line);
    if (cells === undefined) continue;
    const first = cells[0];
    if (first === undefined) continue;
    const id = boldIdentifier(first);
    if (id === undefined) continue;

    const where = `${document}:${index + 1}`;
    if (cells.length !== expectedCells) {
      throw new Error(
        `${where}: ${id} is a bolded identifier in a row of ${cells.length} cells. A ${noun} row has ${expectedCells}.`,
      );
    }
    const firstAt = firstSeenAt.get(id);
    if (firstAt !== undefined) {
      throw new Error(
        `${where}: ${id} is already declared in this ${noun} table, at ${firstAt}. Exactly one row per identifier is allowed.`,
      );
    }
    firstSeenAt.set(id, where);
    rows.push(build(id, cells, where));
  }
  return rows;
}

/**
 * A baseline document's text to the set it declares. Takes text rather than a path, so every test of
 * it is a template literal - the same convention every other parser in this package follows.
 *
 * A requirement absent from all three tables is simply out of baseline: `readSection` only ever adds
 * a row for an identifier actually written down, so silence costs nothing to represent. An `Included`
 * table with no rows is different - it is not a narrower declaration, it is a missing one - so that
 * case is refused explicitly rather than left to the schema's generic "too short" message.
 */
export function parseBaseline(document: string, text: string): Baseline {
  const lines = text.split(/\r?\n/);

  const headingLine = lines.find((line) => HEADING.test(line));
  const name = headingLine === undefined ? '' : (HEADING.exec(headingLine)?.[1] ?? '');

  const bannerLine = lines.find((line) => DECLARED.test(line));
  const declaredAt = bannerLine === undefined ? '' : (DECLARED.exec(bannerLine)?.[1] ?? '');

  const included = readSection(lines, document, '## Included', 'included', 2, (id, cells, where) =>
    validate(Inclusion, { id, why: cells[1] }, where),
  );
  if (included.length === 0) {
    throw new Error(`${document}: the baseline includes nothing, which is not a declaration.`);
  }

  const excluded = readSection(lines, document, '## Excluded', 'excluded', 2, (id, cells, where) =>
    validate(Exclusion, { id, reason: cells[1] }, where),
  );

  const verification = readSection(
    lines,
    document,
    '## Verification',
    'verification',
    3,
    (id, cells, where) => validate(Verification, { id, kind: cells[1], by: cells[2] }, where),
  );

  return validate(Baseline, { name, declaredAt, included, excluded, verification }, document);
}
