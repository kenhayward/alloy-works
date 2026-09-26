import { z } from 'zod';

import type { InlineNode } from '../content/model/inline.js';
import { assignmentSchema } from '../metadata/component-type.js';
import {
  outlineMatterSchema,
  sectionTitleSchema,
  type OutlineMatter,
} from '../structure/outline.js';

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

export const startingSectionSchema: z.ZodType<StartingSection> = z.lazy(() =>
  z.strictObject({
    key,
    title: sectionTitleSchema.refine(
      (title) => title.every((inline) => inline.type !== 'crossReference'),
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
  })
  .superRefine((template, context) => {
    const keys = new Set<string>();
    const walk = (sections: readonly StartingSection[], path: (string | number)[]) => {
      const firstNotFront = sections.findIndex((each) => each.matter !== 'front');
      if (
        firstNotFront >= 0 &&
        sections.slice(firstNotFront).some((each) => each.matter === 'front')
      ) {
        context.addIssue({
          code: 'custom',
          path,
          message: 'Front matter comes before the rest of the outline',
        });
      }
      sections.forEach((each, index) => {
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
