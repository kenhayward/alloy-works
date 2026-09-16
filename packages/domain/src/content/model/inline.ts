import { z } from 'zod';

import { isKeptMathml } from '../admission/mathml.js';

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

/** CNT-027: a target and what to display, never a resolved number or title. */
export const crossReferenceNodeSchema = z.strictObject({
  type: z.literal('crossReference'),
  target: z.string().min(1),
  display: z.enum(['number', 'title', 'numberAndTitle', 'page', 'relative']),
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
  asset: z.string().min(1),
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
