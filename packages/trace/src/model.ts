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

/** Wraps a schema failure in the one thing a person fixing the corpus needs: where it is. */
export function validate<T>(schema: z.ZodType<T>, value: unknown, where: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const detail = result.error.issues
    .map((issue) => `${issue.path.join('.')} ${issue.message}`)
    .join('; ');
  throw new Error(`${where}: ${detail}`);
}
