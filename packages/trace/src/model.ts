import { z } from 'zod';

/** Requirement, non-requirement and open-question identifiers. The shapes are deliberately
 * distinguishable: `ZZZ-N02` and `ZZZ-Q05` cannot be misread as `ZZZ-002`, which is the point of
 * the letter. */
export const REQUIREMENT_ID = /^[A-Z]{3}-\d{3}$/;
export const NON_REQUIREMENT_ID = /^[A-Z]{3}-N\d{2}$/;
export const QUESTION_ID = /^[A-Z]{3}-Q\d{2}$/;
export const AREA_CODE = /^[A-Z]{3}$/;
export const SUPERSEDED_BY = /^Superseded by ([A-Z]{3}-\d{3})$/;

/**
 * The area code fixtures use, permanently reserved and never allocated to a real area.
 *
 * Without it the rule "every identifier a test cites must exist" would refuse this package's own
 * parser fixtures, and excluding the package from the scan would blind the scan to its real tests.
 * Reserving one code keeps the scan honest everywhere and makes the fixture convention explicit.
 */
export const RESERVED_AREA = 'ZZZ';

export const TRANCHES = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'Constraint'] as const;

/** `must` is binding, `should` is a strong default an implementer may argue against in a decision
 * record. A row that says neither commits to nothing and is a defect in the corpus, not a state to
 * represent. */
const BINDING = /\b(must|should)\b/;

export const Status = z
  .string()
  .refine(
    (value) => value === 'Specified' || value === 'Withdrawn' || SUPERSEDED_BY.test(value),
    'must be Specified, Withdrawn, or "Superseded by XXX-NNN"',
  );

export const Requirement = z.object({
  id: z.string().regex(REQUIREMENT_ID),
  area: z.string().regex(AREA_CODE),
  statement: z.string().min(1).regex(BINDING, 'must say must or should'),
  tranche: z.enum(TRANCHES),
  status: Status,
  document: z.string().min(1),
  line: z.number().int().positive(),
});
export type Requirement = z.infer<typeof Requirement>;

export const NonRequirement = z.object({
  id: z.string().regex(NON_REQUIREMENT_ID),
  statement: z.string().min(1),
  document: z.string().min(1),
  line: z.number().int().positive(),
});
export type NonRequirement = z.infer<typeof NonRequirement>;

export const Question = z.object({
  id: z.string().regex(QUESTION_ID),
  question: z.string().min(1),
  settledBy: z.string().min(1),
  document: z.string().min(1),
  line: z.number().int().positive(),
});
export type Question = z.infer<typeof Question>;

export const DesignClaim = z.object({
  id: z.string().regex(REQUIREMENT_ID),
  howItIsMet: z.string().min(1),
});
export type DesignClaim = z.infer<typeof DesignClaim>;

/** Where a test names a requirement: in its own title, or in the `rule:` field of a refusal. */
export const Citation = z.object({
  id: z.string().regex(REQUIREMENT_ID),
  file: z.string().min(1),
  line: z.number().int().positive(),
  kind: z.enum(['title', 'rule']),
});
export type Citation = z.infer<typeof Citation>;

export const Design = z.object({
  document: z.string().min(1),
  owns: z.array(DesignClaim),
});
export type Design = z.infer<typeof Design>;

/**
 * Deliberately carries no commit hash, no timestamp, and no test results. The commit that holds the
 * file is its provenance; a hash or a timestamp would change on every commit, and a result changes
 * on every RUN - all three would make the drift check in `trace.test.ts` impossible to pass.
 *
 * Citations are here because they are a function of the source, exactly like a requirement or a
 * design claim. Results are read at query time from a Vitest JSON report instead.
 */
export const TraceModel = z.object({
  requirements: z.array(Requirement),
  nonRequirements: z.array(NonRequirement),
  questions: z.array(Question),
  designs: z.array(Design),
  citations: z.array(Citation),
});
export type TraceModel = z.infer<typeof TraceModel>;

/** Why a requirement somebody might expect in the baseline is not in it. A reason is mandatory. */
export const Exclusion = z.object({
  id: z.string().regex(REQUIREMENT_ID),
  reason: z.string().min(1),
});
export type Exclusion = z.infer<typeof Exclusion>;

export const VERIFICATION_KINDS = ['test', 'inherited', 'attestation', 'local-run'] as const;

/**
 * How a requirement is shown to be met. `test` is the default and needs no declaration: a test names
 * it and passes. `inherited` and `attestation` exist because a constraint that governs how everything
 * is built often cannot be reached by a test named after it, and pretending otherwise is how a
 * traceability matrix becomes a lie that passes. `local-run` is for a requirement only a run on a
 * particular machine can verify - Word's, which CI does not have (the W15 plan's W15-D): its tests are
 * named and run as any other, and the gate reads their outcomes from the run's reduced report.
 */
export const Verification = z.object({
  id: z.string().regex(REQUIREMENT_ID),
  kind: z.enum(VERIFICATION_KINDS),
  by: z.string().min(1),
});
export type Verification = z.infer<typeof Verification>;

/** A date in `YYYY-MM-DD` form, anywhere in the text - an attestation's `by` cell is prose ("Ada
 * Lovelace, checked 2026-09-13"), not a bare date, so this is not anchored. */
const ATTESTATION_DATE = /\d{4}-\d{2}-\d{2}/;

/** The floor the design's section 6 demands: an attestation "names a person and a date" and is
 * "deliberately expensive to use". Below this, "Ada" plus a date is indistinguishable from a
 * placeholder - the cheapest way to widen a baseline must not also be the easiest. */
export const ATTESTATION_MIN_LENGTH = 30;

/**
 * Whether an attestation's `by` field clears the bar the design demands. Shared between
 * `parse/baseline.ts`, which refuses a malformed document outright at parse time, and `gate.ts`,
 * which must not trust a `Baseline` built programmatically - bypassing the parser entirely - to have
 * already been checked. One predicate, one bar, so the two can never quietly disagree about what
 * counts as substantial.
 */
/**
 * The identifiers an `inherited` row rests on: one, or several separated by commas, every one of which
 * must be included and met. Several is how a requirement verified only by two others together says so -
 * CNT-078, by CNT-177's audit and CNT-176's suite - so a baseline cannot meet it from either alone.
 */
export function inheritedFrom(by: string): string[] {
  return by.split(',').map((each) => each.trim());
}

/**
 * The records under `docs/audits/` an attestation names, which the gate asks are there when it is told
 * how to look.
 */
export function recordsNamed(by: string): string[] {
  // Up to the next space, comma, semicolon, bracket or backtick, and without a closing full stop: the
  // path as the row sets it off, whatever it is, for `isRecordOf` to judge.
  return [...by.matchAll(/docs\/audits\/[^\s,;)`]*/g)].map((match) => match[0].replace(/\.+$/, ''));
}

/**
 * Whether `path` is a record of release `version`: `docs/audits/<version>/<name>.md` and nothing else -
 * never a folder, another release's record, or a path that climbs out of `docs/audits/`.
 */
export function isRecordOf(path: string, version: string): boolean {
  const match = /^docs\/audits\/([0-9A-Za-z.+-]+)\/[a-z0-9-]+\.md$/.exec(path);
  return match !== null && match[1] === version;
}

/**
 * What a `local-run` row declares: the record of the run under `docs/audits/<this release>/`, and the
 * report `pnpm trace record-run` reduced beside it, the same name ending `.json`.
 */
export interface LocalRunDeclaration {
  readonly record: string;
  readonly report: string;
}

/**
 * A `local-run` row's `by` read against release `version`: it names a person, a date in `YYYY-MM-DD`
 * form and exactly one record of this release - `Ada, 2026-09-30, docs/audits/0.126.0/word.md`. Shared
 * by the parser, which refuses a row that does not, and the gate, which must not trust a `Baseline`
 * built by hand to have been parsed.
 */
export function localRunDeclared(
  by: string,
  version: string,
): LocalRunDeclaration | { readonly refused: string } {
  const records = recordsNamed(by);
  const person = records
    .reduce((rest, record) => rest.replace(record, ''), by)
    .replace(ATTESTATION_DATE, '');
  if (!/\p{L}/u.test(person)) return { refused: 'names no person who ran it' };
  if (!ATTESTATION_DATE.test(by)) return { refused: 'names no date in YYYY-MM-DD form' };
  if (records.length !== 1) {
    return { refused: `must name exactly one record under docs/audits/, not ${records.length}` };
  }
  const record = records[0]!;
  if (!isRecordOf(record, version)) {
    return { refused: `names ${record}, which is not a record of this release` };
  }
  return { record, report: record.replace(/\.md$/, '.json') };
}

export function attestationIsSubstantial(by: string): boolean {
  return by.length >= ATTESTATION_MIN_LENGTH && ATTESTATION_DATE.test(by);
}

export const Inclusion = z.object({
  id: z.string().regex(REQUIREMENT_ID),
  why: z.string().min(1),
});
export type Inclusion = z.infer<typeof Inclusion>;

/**
 * The set of requirements a release is answerable for.
 *
 * Hand-written and committed. No command may rewrite it: a baseline a tool can edit is not a
 * declaration, and the whole value of one is that a person put their name to it.
 */
export const Baseline = z.object({
  name: z.string().min(1),
  declaredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  included: z.array(Inclusion).min(1),
  excluded: z.array(Exclusion),
  verification: z.array(Verification),
});
export type Baseline = z.infer<typeof Baseline>;

/** Wraps a schema failure in the one thing a person fixing the corpus needs: where it is. */
export function validate<T>(schema: z.ZodType<T>, value: unknown, where: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const detail = result.error.issues
    .map((issue) => `${issue.path.join('.')} ${issue.message}`)
    .join('; ');
  throw new Error(`${where}: ${detail}`);
}
