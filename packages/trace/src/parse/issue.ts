import { z } from 'zod';

import { AREA_CODE, validate } from '../model.js';

/** What GitHub writes into an issue-form field left blank. The one string this parser treats as
 * "the author answered nothing", for each of the three optional fields. */
const NO_RESPONSE = '_No response_';

/** `must` is binding, `should` is a strong default an author may argue against later; the same rule
 * `model.ts`'s `Requirement` schema applies to a corpus row. A statement that says neither commits
 * to nothing, and catching that here - at intake - means it can be sent back to the person who filed
 * it, rather than discovered later inside the corpus. */
const BINDING = /\b(must|should)\b/;

/** The tranche dropdown's escape hatch for someone who does not know - a placement the corpus should
 * record as absent, not as the literal word "Not sure". */
const TRANCHE_NOT_SURE = 'Not sure';

/**
 * The level-three headings GitHub renders a filed requirement's answers under. These are Task 1's
 * field labels, taken verbatim from `.github/ISSUE_TEMPLATE/requirement.yml` - inventing a label
 * here would make this parser work on its own fixtures and fail on every real issue.
 */
const HEADING = {
  area: 'Area',
  statement: 'The requirement',
  why: 'Why',
  howWeWouldKnow: 'How we would know',
  tranche: 'Suggested tranche',
  whoAsked: 'Who asked',
} as const;

export const FiledRequirement = z.object({
  area: z.string().regex(AREA_CODE),
  statement: z.string().min(1).regex(BINDING, 'must say must or should'),
  why: z.string().min(1),
  howWeWouldKnow: z.string().optional(),
  tranche: z.string().optional(),
  whoAsked: z.string().optional(),
});
export type FiledRequirement = z.infer<typeof FiledRequirement>;

/** A `### <label>` heading line, capturing the label. Matching `^### ` alone is not enough to keep
 * an occurrence inside an answer - a quoted markdown snippet, say - from being mistaken for a field
 * boundary: a filer can legitimately type a line that starts with `### ` as part of an example. Two
 * further checks in `readAnswers` do the rest: only a heading whose text is one of the six known
 * labels is a candidate at all, and one inside a fenced code block - the responsible way to quote a
 * markdown snippet - is never a candidate, fenced or not. */
const FIELD_HEADING = /^### (.+?)\s*$/gm;

/** The six field labels a real field boundary can ever be - see `HEADING` above. A `### ` line
 * whose text is anything else is never a boundary, however it got there. */
const KNOWN_LABELS: readonly string[] = Object.values(HEADING);

/** A fenced code block's delimiter line, opening or closing. Content between an odd-numbered and the
 * next even-numbered occurrence is fenced. */
const FENCE_LINE = /^```.*$/gm;

/** The character ranges of every fenced code block in `body`, each `[start, end)` running from the
 * opening fence line to the end of its closing fence line. An unterminated fence (no closing line) is
 * not a range at all - the odd fence line left over is simply ignored, the same as CommonMark treats
 * an unterminated fence as running to the end of the document, which has no bearing here since there
 * is nothing left in the body to protect. */
function fencedRanges(body: string): Array<readonly [number, number]> {
  const fenceLines = [...body.matchAll(FENCE_LINE)];
  const ranges: Array<readonly [number, number]> = [];
  for (let index = 0; index + 1 < fenceLines.length; index += 2) {
    const open = fenceLines[index]!;
    const close = fenceLines[index + 1]!;
    ranges.push([open.index, close.index + close[0].length]);
  }
  return ranges;
}

function isFenced(position: number, ranges: Array<readonly [number, number]>): boolean {
  return ranges.some(([start, end]) => position >= start && position < end);
}

/**
 * A filed issue's body to the answer under each `### <label>` heading, trimmed. Reads every heading
 * present regardless of order, because GitHub preserves the form's order but a hand-edited issue may
 * not - a parser that depended on order would fail on a perfectly good issue.
 *
 * Only a `### ` line whose text is one of the six known labels, and that is not inside a fenced code
 * block, counts as a field boundary. A real duplicate of a known heading - not explained by fencing -
 * is refused outright: this parser has no way to tell which of two answers under the same label is
 * the real one, and guessing (by taking the first or the last) would silently accept a malformed
 * issue instead of sending it back.
 */
function readAnswers(body: string): Map<string, string> {
  const ranges = fencedRanges(body);
  const matches = [...body.matchAll(FIELD_HEADING)].filter(
    (match) => KNOWN_LABELS.includes(match[1]!) && !isFenced(match.index, ranges),
  );

  const answers = new Map<string, string>();
  for (const [index, match] of matches.entries()) {
    const label = match[1]!;
    if (answers.has(label)) {
      throw new Error(
        `the filed issue has more than one "### ${label}" heading - this parser cannot tell which ` +
          'answer is the real one, so it is refusing rather than guessing.',
      );
    }
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? body.length;
    answers.set(label, body.slice(start, end).trim());
  }
  return answers;
}

/** The answer under `label`, or `undefined` when it is missing or GitHub's placeholder for "left
 * blank". Never `undefined` for "present but empty" versus "absent" - a filed issue has no way to
 * say that, so this parser does not distinguish it either. */
function optionalAnswer(answers: Map<string, string>, label: string): string | undefined {
  const raw = answers.get(label);
  return raw === undefined || raw === NO_RESPONSE ? undefined : raw;
}

/** The answer under `label`, or a thrown error naming the heading a filed issue's parser could not
 * find - the detail an author acting on the failure needs, not just "invalid issue". */
function requiredAnswer(answers: Map<string, string>, label: string): string {
  const value = optionalAnswer(answers, label);
  if (value === undefined) {
    throw new Error(
      `the filed issue has no "${label}" heading - every requirement issue has one, and without it ` +
        'there is nothing here to draft.',
    );
  }
  return value;
}

/**
 * A filed issue's body - as GitHub's requirement form renders it, `### <label>` headings with the
 * answer beneath, and `_No response_` for a field left blank - to the requirement it proposes. Takes
 * text, not the issue itself, so this stays pure: no `node:fs`, no `gh`, no network, and every test
 * of it is a template literal.
 */
export function parseIssue(body: string): FiledRequirement {
  const answers = readAnswers(body);

  const areaAnswer = requiredAnswer(answers, HEADING.area);
  // The dropdown's option carries the code and its description together ("CNT - Content and
  // authoring"); the corpus only ever wants the code.
  const area = areaAnswer.slice(0, 3);

  const statement = requiredAnswer(answers, HEADING.statement);
  const why = requiredAnswer(answers, HEADING.why);

  const howWeWouldKnow = optionalAnswer(answers, HEADING.howWeWouldKnow);
  const rawTranche = optionalAnswer(answers, HEADING.tranche);
  const tranche = rawTranche === TRANCHE_NOT_SURE ? undefined : rawTranche;
  const whoAsked = optionalAnswer(answers, HEADING.whoAsked);

  return validate(
    FiledRequirement,
    { area, statement, why, howWeWouldKnow, tranche, whoAsked },
    'the filed issue',
  );
}
