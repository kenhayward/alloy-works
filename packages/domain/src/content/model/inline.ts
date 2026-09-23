import { z } from 'zod';

import { isKeptMathml } from '../admission/mathml.js';

import { artifactIdentifierSchema, nodeIdentifierSchema } from './identifier.js';
import { markSchema } from './marks.js';

/**
 * CNT-022, AST-012, AST-013, AST-015. A three-state rather than an optional string, because an
 * optional string makes empty mean both "nobody supplied it" and "deliberately decorative" - and that
 * ambiguity is how an inaccessible document passes its own check. Absent is not a state.
 */
export const alternativeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('own'), text: z.string().min(1) }),
  z.strictObject({ kind: z.literal('inherited') }),
  z.strictObject({ kind: z.literal('decorative') }),
]);

export type Alternative = z.infer<typeof alternativeSchema>;

export const textNodeSchema = z.strictObject({
  type: z.literal('text'),
  value: z.string(),
  marks: z.array(markSchema).default([]),
});

/**
 * CNT-043: MathML is canonical. The LaTeX typed is a non-authoritative input record.
 *
 * The MathML is refused unless the admission pipeline's strict reader would keep it exactly as it
 * stands, because it is the one string in the model rendered as markup: content reaching validation
 * by any path but admission - an iteration the service parses, a version read back - must not carry
 * what sanitise removes from a paste. The check is the reader itself, never a second description.
 */
export const equationContentSchema = {
  mathml: z.string().min(1).refine(isKeptMathml, 'not in the one form the MathML reader writes'),
  latex: z.string().min(1).optional(),
};

export const inlineEquationNodeSchema = z.strictObject({
  type: z.literal('equation'),
  ...equationContentSchema,
});

/**
 * What a cross-reference points at (STR-026): a closed union, each kind naming an identity and never
 * a position, and none naming an answer (STR-028).
 *
 * - `block`: a block or a footnote of the component the reference is stored in. It carries no
 *   occurrence, because a component does not know where it is placed: resolution binds it to the
 *   occurrence being read, so one stored "see Figure 2" is Figure 2 in one place and Figure 7 in
 *   another (STR-056).
 * - `component`: a block or a footnote of another component, resolved against that component's one
 *   occurrence in the resolving document - and failed by name, never guessed, where it has none or
 *   several (STR-062). Named by the component rather than by an occurrence so that the reference
 *   survives the component being used in a second document.
 * - `node`: an outline node - a section, from a section title or from a component's text (XR-B).
 *   It belongs to one document's outline, so a component's resolves in that document and fails by
 *   name in any other the component is placed in (STR-029).
 *
 * Which kind may stand where is `checkInlineContent`'s rule, not this schema's, because the schema
 * does not know whether it is parsing a component or a title. A bibliography entry (STR-026) is not
 * here until LIB says what an entry's identity is; adding a kind changes nothing stored.
 */
export const crossReferenceTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('block'), block: z.string().min(1) }),
  z.strictObject({
    kind: z.literal('component'),
    component: artifactIdentifierSchema,
    block: z.string().min(1),
  }),
  z.strictObject({ kind: z.literal('node'), node: nodeIdentifierSchema }),
]);

/** The forms a reference to a page may fall back to where the output has no pages (STR-055). */
const withoutPagesForms = ['number', 'title', 'numberAndTitle'] as const;

/**
 * CNT-027: a target and what to display, never a resolved number or title. `id` is the reference's
 * own, unique in what holds it, so the failure STR-029 requires can name the reference as well as its
 * target. `withoutPages` is STR-055's declared alternative, and only a page reference carries one:
 * absent there means none was declared, and the publish fails in an output with no pages.
 */
export const crossReferenceNodeSchema = z
  .strictObject({
    type: z.literal('crossReference'),
    id: z.string().min(1),
    target: crossReferenceTargetSchema,
    display: z.enum(['number', 'title', 'numberAndTitle', 'page', 'relative']),
    withoutPages: z.enum(withoutPagesForms).optional(),
  })
  .refine((node) => node.withoutPages === undefined || node.display === 'page', {
    message: 'Only a reference to a page declares a form for an output with no pages',
    path: ['withoutPages'],
  });

export const citationNodeSchema = z.strictObject({
  type: z.literal('citation'),
  entry: z.string().min(1),
  locator: z.string().min(1).optional(),
});

export const variableNodeSchema = z.strictObject({
  type: z.literal('variable'),
  name: z.string().min(1),
});

export const bindingNodeSchema = z.strictObject({
  type: z.literal('binding'),
  query: z.string().min(1),
});

export const imageNodeSchema = z.strictObject({
  type: z.literal('image'),
  // An asset version, pinned, as a figure's is (figures 1, R4).
  asset: artifactIdentifierSchema,
  imageStyle: z.string().min(1),
  alternative: alternativeSchema,
});

/**
 * CNT-026, CNT-036, CNT-037, CNT-038. The anchor carries the note, so a moved anchor moves its note.
 * `content` is a restricted block sequence (CNT-129) and is tightened in `blocks.ts`, where the
 * recursion between blocks and inlines closes.
 */
export const footnoteNodeSchema = z.strictObject({
  type: z.literal('footnote'),
  id: z.string().min(1),
  anchor: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('span') }),
    z.strictObject({ kind: z.literal('cell'), key: z.string().min(1) }),
    z.strictObject({
      kind: z.literal('cellPosition'),
      row: z.number().int().min(0),
      column: z.number().int().min(0),
    }),
    z.strictObject({ kind: z.literal('table') }),
  ]),
  content: z.array(z.unknown()),
});

export const inlineNodeSchema = z.discriminatedUnion('type', [
  textNodeSchema,
  inlineEquationNodeSchema,
  footnoteNodeSchema,
  crossReferenceNodeSchema,
  citationNodeSchema,
  variableNodeSchema,
  bindingNodeSchema,
  imageNodeSchema,
]);

export type InlineNode = z.infer<typeof inlineNodeSchema>;

/** What a cross-reference points at, as the model stores it (STR-026). */
export type CrossReferenceTarget = z.infer<typeof crossReferenceTargetSchema>;

/**
 * What a cross-reference shows (CNT-027): a number, a title, both, a page, or where the target stands
 * - `above` or `below`. The stored enum, named once, so an editor offering forms and a function saying
 * what each prints cannot offer one the model would refuse.
 */
export type CrossReferenceDisplay = z.infer<typeof crossReferenceNodeSchema>['display'];
