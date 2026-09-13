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

/** A `### <label>` heading line, capturing the label. Matches on its own line so an occurrence of
 * `### ` inside an answer - a quoted markdown snippet, say - is never mistaken for a field boundary;
 * every field boundary in a filed issue's body starts a line. */
const FIELD_HEADING = /^### (.+?)\s*$/gm;

/**
 * A filed issue's body to the answer under each `### <label>` heading, trimmed. Reads every heading
 * present regardless of order, because GitHub preserves the form's order but a hand-edited issue may
 * not - a parser that depended on order would fail on a perfectly good issue.
 */
function readAnswers(body: string): Map<string, string> {
  const matches = [...body.matchAll(FIELD_HEADING)];
  const answers = new Map<string, string>();
  for (const [index, match] of matches.entries()) {
    const label = match[1]!;
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
