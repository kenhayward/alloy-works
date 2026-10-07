import { z } from 'zod';

import type { InlineNode } from '../content/model/inline.js';
import { checkPermitted } from '../data/definition.js';
import { assignmentSchema } from '../metadata/component-type.js';
import {
  outlineMatterSchema,
  sectionTitleSchema,
  type OutlineMatter,
} from '../structure/outline.js';

import { MAX_TEMPLATE_PARAMETERS, templateParameterSchema } from './parameters.js';

/**
 * The version of a template's own payload (templates.md, "The definition"), recorded in it and
 * migrated like any stored shape when it changes.
 */
export const TEMPLATE_SCHEMA_VERSION = 1;

/** A starting section's key: a plain token, stable across the template's versions (TE-C). */
const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, 'A key is a plain token');

/**
 * A section of the outline a document starts with (TPL-012): its key, its title - a section title's
 * content with no cross-reference, since a starting outline holds nothing to point at - whether a
 * document may publish without it (TPL-013), and the switches its section node takes.
 */
export type StartingSection = {
  readonly key: string;
  readonly title: readonly InlineNode[];
  readonly required: boolean;
  readonly numbered: boolean;
  readonly matter: OutlineMatter;
  readonly pageBreak: 'none' | 'page' | 'recto';
  readonly children: readonly StartingSection[];
};

/** Whether inline content holds a cross-reference anywhere, a footnote's paragraphs included. */
function refers(inlines: readonly InlineNode[]): boolean {
  return inlines.some(
    (inline) =>
      inline.type === 'crossReference' ||
      (inline.type === 'footnote' &&
        (inline.content as { content?: InlineNode[] }[]).some((paragraph) =>
          refers(paragraph.content ?? []),
        )),
  );
}

export const startingSectionSchema: z.ZodType<StartingSection> = z.lazy(() =>
  z.strictObject({
    key,
    title: sectionTitleSchema.refine(
      (title) => !refers(title),
      'A starting section title holds no cross-reference: it has nothing yet to point at',
    ),
    required: z.boolean(),
    numbered: z.boolean(),
    matter: outlineMatterSchema,
    pageBreak: z.enum(['none', 'page', 'recto']),
    children: z.array(startingSectionSchema),
  }),
);

/**
 * A schema a template assigns (TPL-054): at the document's level or its sections', and with nothing
 * but the fields it makes required - the component type's MET-009 shape, so an assignment cannot
 * loosen a field, change a default or fix a value, because there is nowhere to say so.
 */
export const templateAssignmentSchema = assignmentSchema.extend({
  level: z.enum(['document', 'section']),
});

export type TemplateAssignment = z.infer<typeof templateAssignmentSchema>;

const artifact = z.uuid();

/**
 * A template's payload (templates.md; TPL-059, TPL-053): exactly one theme and one layout by
 * reference, any number of schema assignments by reference, the starting outline it owns, and what
 * an author may change (TPL-015). It carries no `id`: a template is identified by its artifact row,
 * as a document is.
 *
 * `checkTemplate`'s rules are the refinement: a key once across the tree, front matter before the
 * rest at each level as an outline's own rule has it (STR-064), a schema assigned once at a level, and
 * a field required once by an assignment. Nothing here reads another artifact; whether the references
 * resolve is `resolveTemplate`'s.
 */
export const templateDefinitionSchema = z
  .strictObject({
    schemaVersion: z.literal(TEMPLATE_SCHEMA_VERSION),
    name: z
      .string()
      .max(200)
      .refine((name) => name.trim() !== '', 'A template needs a name'),
    theme: artifact,
    layout: artifact,
    schemas: z.array(templateAssignmentSchema),
    outline: z.strictObject({ sections: z.array(startingSectionSchema) }),
    changes: z.strictObject({ add: z.boolean(), remove: z.boolean(), reorder: z.boolean() }),
    // Additive at schema 1: absent reads as none (templates.md, "Declared on the template").
    parameters: z.array(templateParameterSchema).max(MAX_TEMPLATE_PARAMETERS).optional(),
  })
  .superRefine((template, context) => {
    const keys = new Set<string>();
    // Matter as an outline holds it (STR-064): set at the top level, front matter first there, and
    // every section below it body, since a subtree takes its top-level section's matter.
    const top = template.outline.sections;
    const firstNotFront = top.findIndex((each) => each.matter !== 'front');
    if (firstNotFront >= 0 && top.slice(firstNotFront).some((each) => each.matter === 'front')) {
      context.addIssue({
        code: 'custom',
        path: ['outline', 'sections'],
        message: 'Front matter comes before the rest of the outline',
      });
    }
    const walk = (sections: readonly StartingSection[], path: (string | number)[]) => {
      sections.forEach((each, index) => {
        if (path.length > 2 && each.matter !== 'body') {
          context.addIssue({
            code: 'custom',
            path: [...path, index, 'matter'],
            message: "A section below the top level is body matter: it takes its top section's",
          });
        }
        if (keys.has(each.key)) {
          context.addIssue({
            code: 'custom',
            path: [...path, index, 'key'],
            message: `The key ${each.key} names more than one starting section`,
          });
        }
        keys.add(each.key);
        walk(each.children, [...path, index, 'children']);
      });
    };
    walk(template.outline.sections, ['outline', 'sections']);

    // A parameter named once, and its permitted values or range in its type, by the query
    // definition's own rule (TE-N, TP1-A).
    const names = new Set<string>();
    (template.parameters ?? []).forEach((parameter, index) => {
      if (names.has(parameter.name)) {
        context.addIssue({
          code: 'custom',
          path: ['parameters', index, 'name'],
          message: `The parameter ${parameter.name} is declared more than once`,
        });
      }
      names.add(parameter.name);
      checkPermitted(parameter, `parameters.${index}`, (path, message) =>
        context.addIssue({
          code: 'custom',
          path: path.split('.').map((each) => (/^\d+$/.test(each) ? Number(each) : each)),
          message,
        }),
      );
    });

    const assigned = new Set<string>();
    template.schemas.forEach((assignment, index) => {
      const at = `${assignment.level} ${assignment.schema}`;
      if (assigned.has(at)) {
        context.addIssue({
          code: 'custom',
          path: ['schemas', index, 'schema'],
          message: `Schema ${assignment.schema} is assigned at the ${assignment.level} level more than once`,
        });
      }
      assigned.add(at);
      if (new Set(assignment.requires).size !== assignment.requires.length) {
        context.addIssue({
          code: 'custom',
          path: ['schemas', index, 'requires'],
          message: `The assignment of ${assignment.schema} requires a field more than once`,
        });
      }
    });
  });

export type TemplateDefinition = z.infer<typeof templateDefinitionSchema>;
