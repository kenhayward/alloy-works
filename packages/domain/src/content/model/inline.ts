import { z } from 'zod';

import { isKeptMathml } from '../admission/mathml.js';
import { canonicalValueSchema, PARAMETER_NAME } from '../../data/definition.js';
import { MAX_LIST_ITEMS } from '../../data/parameters.js';
import { sourceNameSchema } from '../../data/protocol.js';

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
 *   survives the component being used in a second document. One naming the component it is stored
 *   in - a paste from another component leaves it so - resolves as a `block` target does.
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

/** The most parameters a binding names, as a definition declares at most 50 (D3-C). */
const MAX_BINDING_PARAMETERS = 50;
/** The most columns a binding's key names, as a definition's key holds at most 32 (D3-C). */
const MAX_KEY_COLUMNS = 32;

/** A parameter's name, as a definition declares one (D2's pattern). */
const parameterName = z.string().regex(PARAMETER_NAME, 'not a parameter name');

/** A value a binding names, never null: one item of a list, and one column of a key. */
const presentValue = canonicalValueSchema.refine((value) => value !== null, 'never null here');

/**
 * What a binding runs its definition with, by the definition's parameter names (DAT-030): a literal -
 * a canonical value, or a list of 1 to 50 of them, none null - or the document's own parameter of a
 * name, which no document has until TPL-020. Whether a literal is canonical in its parameter's type
 * is decided where the binding is resolved, against the definition version it resolves to, since a
 * floating binding's definition can change after the component is saved (D3-L).
 */
const bindingParameterSchema = z.union([
  z.strictObject({
    literal: z.union([canonicalValueSchema, z.array(presentValue).min(1).max(MAX_LIST_ITEMS)]),
  }),
  z.strictObject({ document: parameterName }),
]);

/**
 * What an inline binding takes (DAT-067): the column of a result of exactly one row, or the column of
 * the row a key names - and no third form. Whether the column and the key are the definition's is
 * checked where the binding is resolved (`checkTake`), as a cross-reference's target is.
 */
const takeSchema = z.union([
  z.strictObject({ column: sourceNameSchema }),
  z.strictObject({
    key: z.record(sourceNameSchema, presentValue).refine((key) => {
      const size = Object.keys(key).length;
      return size >= 1 && size <= MAX_KEY_COLUMNS;
    }, 'a key names 1 to 32 columns'),
    column: sourceNameSchema,
  }),
]);

/** Every string a value holds, its members' names among them. */
function* stringsIn(value: unknown): Generator<string> {
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value)) for (const member of value) yield* stringsIn(member);
  else if (typeof value === 'object' && value !== null) {
    for (const [name, member] of Object.entries(value)) {
      yield name;
      yield* stringsIn(member);
    }
  }
}

/**
 * CNT-030, DAT-029: a binding names a query definition, optionally one of its versions - pinned;
 * absent, it floats at the latest (DAT-015) - its parameters, its mode (DAT-082) and the value it
 * takes, and never holds a value (the D3 plan, D3-C). One component serves many documents, each with
 * its own accepted result, so the result lives in the document's resolution, never here. `id` is an
 * identifier of the component's, unique among them and in NFC, claimed by the walk in `document.ts`.
 *
 * **Every string in NFC**, as a definition's are (D2-F): the canonical form writes a string in NFC, so
 * a decomposed literal would be digested as the composed one while the source compared it as written,
 * and a member's name is not normalised by the canonical form at all. Refused, never normalised: what
 * is stored is what the digest covers.
 */
const bindingShape = {
  type: z.literal('binding'),
  id: z.string().min(1),
  query: artifactIdentifierSchema,
  version: artifactIdentifierSchema.optional(),
  parameters: z
    .record(parameterName, bindingParameterSchema)
    .refine(
      (parameters) => Object.keys(parameters).length <= MAX_BINDING_PARAMETERS,
      'a binding names at most 50 parameters',
    ),
  mode: z.enum(['checked', 'pinned']),
};

export const bindingNodeSchema = z
  .strictObject({ ...bindingShape, take: takeSchema })
  .refine(
    (binding) =>
      [...stringsIn({ parameters: binding.parameters, take: binding.take })].every(
        (text) => text === text.normalize('NFC'),
      ),
    { message: 'A binding holds every string in NFC' },
  );

/**
 * **A bound table's binding** (the TB1 plan, TB1-A): an inline binding's members with no `take`, since
 * a table binds the whole result. Built from the same shape rather than by omitting `take` from
 * `bindingNodeSchema`, which a refined object cannot do; `type: 'binding'` kept, so its digest is the
 * canonical form of what it holds, as an inline binding's is. Every string in NFC, for the same reason.
 */
export const tableBindingSchema = z
  .strictObject(bindingShape)
  .refine(
    (binding) =>
      [...stringsIn({ parameters: binding.parameters })].every(
        (text) => text === text.normalize('NFC'),
      ),
    { message: 'A binding holds every string in NFC' },
  );

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
