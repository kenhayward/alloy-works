import { nextIdentifier } from './format.js';
import { REQUIREMENT_ID, type TraceModel } from './model.js';
import type { FiledRequirement } from './parse/issue.js';
import { boldIdentifier, tableCells } from './parse/table.js';

/** `must` is binding, `should` is a strong default - the same rule `model.ts`'s `Requirement`
 * schema and `parse/issue.ts` apply. `parseIssue` already refuses a statement that says neither, so
 * checking again here is belt and braces for a `FiledRequirement` somebody built by hand rather than
 * through the issue form - the flag path in `cli.ts` (Task 4) is exactly that. */
const BINDING = /\b(must|should)\b/;

/**
 * The tranche a row carries when the filer did not say. Deliberately not `T1` - a default would
 * hide the decision a person still has to make. `T?` is not in `TRANCHES` (see `model.ts`), so
 * `Requirement`'s schema - and therefore `parseAreaDocument` - refuses any committed document that
 * still carries it. The placeholder cannot be forgotten because the corpus will not parse with it in.
 */
const UNKNOWN_TRANCHE = 'T?';

/** A `## ` or `### ` heading line, capturing its text (numbering and all, exactly as printed). */
const HEADING = /^#{2,3}\s+(.+?)\s*$/;

/**
 * A markdown table cell must be one line and must not contain an unescaped pipe - `parse/table.ts`'s
 * `tableCells` splits a row on newlines-as-rows and on an unescaped pipe - so both are dealt with on
 * the way into a row.
 *
 * "The requirement" is a textarea, and `parse/issue.ts` deliberately keeps a multi-paragraph answer
 * whole. Left alone, a two-paragraph statement produces a row containing a blank line, which is no
 * longer one table row: `parseAreaDocument` reads only the first physical line as the row and the
 * rest as ordinary prose, so the requirement is silently absent from the corpus with no error
 * anywhere. A requirement statement is one sentence by convention, so collapsing every run of
 * whitespace - newlines, tabs, repeated spaces - into a single space is the correct normalisation
 * here, not a workaround.
 *
 * The pipe escape only touches a pipe not already escaped, matching the same
 * `(?<!\\)\|` convention `tableCells` splits on - escaping an already-escaped `\|` again would double
 * the backslash (`\|` becoming `\\|`) and leave a stray backslash in the statement once the row is
 * parsed back.
 */
function escapeCell(cell: string): string {
  const oneLine = cell.replace(/\s+/g, ' ').trim();
  return oneLine.replace(/(?<!\\)\|/g, '\\|');
}

/**
 * Whether a table row already in `line` is a requirement row - bolded `AAA-NNN` in its first cell,
 * four cells - the same test `parse/requirements.ts` applies, but only the identifying shape: a
 * candidate section is offered on the strength of holding such a row, not on the row surviving full
 * `Requirement` validation, since a document mid-edit may have other problems that are not this
 * function's job to notice.
 */
function isRequirementRow(line: string): boolean {
  const cells = tableCells(line);
  if (cells === undefined || cells.length !== 4) return false;
  const first = cells[0];
  if (first === undefined) return false;
  const id = boldIdentifier(first);
  return id !== undefined && REQUIREMENT_ID.test(id);
}

/**
 * The level-two and level-three headings of an area document that already introduce a requirements
 * table - candidates for where a new row might belong. Never picks among them: the design behind
 * this whole stage is that a tool that chose would file a footnote requirement under tables, and the
 * corpus would still parse, so nothing would catch it. A person makes the one judgement this leaves.
 */
export function sectionsWithRequirements(areaDocumentText: string): string[] {
  const sections: string[] = [];
  let current: string | undefined;

  for (const line of areaDocumentText.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading !== null) {
      current = heading[1];
      continue;
    }
    if (current === undefined || sections.includes(current)) continue;
    if (isRequirementRow(line)) sections.push(current);
  }

  return sections;
}

export interface Draft {
  readonly id: string;
  readonly row: string;
  readonly sections: string[];
  readonly warnings: string[];
}

/**
 * A filed requirement to the two things a person needs to land it: an identifier that is never
 * reused, and a table row the requirement parser will accept. Pure - no `node:fs` - so `cli.ts`
 * reads both the issue and the area document and hands this function their text.
 *
 * Takes no issue number: the requirements table has exactly four columns (ID, Requirement, Tranche,
 * Status), so there is nowhere in a row for one, and the link belongs in the pull request body
 * instead. `cli.ts` prints the `Fixes #<issue>` reminder itself, from whichever of the two ways in
 * supplied a number.
 */
export function draftRequirement(
  filed: FiledRequirement,
  model: TraceModel,
  areaDocumentText: string,
): Draft {
  const id = nextIdentifier(model, filed.area);
  const tranche = filed.tranche ?? UNKNOWN_TRANCHE;
  const row = `| **${id}** | ${escapeCell(filed.statement)} | ${tranche} | Specified |`;
  const sections = sectionsWithRequirements(areaDocumentText);

  const warnings: string[] = [];
  if (filed.tranche === undefined) {
    warnings.push(
      `No tranche given - the row carries the placeholder "${UNKNOWN_TRANCHE}", which the parser refuses until a person replaces it.`,
    );
  }
  if (filed.howWeWouldKnow === undefined) {
    warnings.push('No test hint given - "how we would know" was left blank.');
  }
  if (!BINDING.test(filed.statement)) {
    warnings.push('The statement says neither "must" nor "should".');
  }

  return { id, row, sections, warnings };
}
