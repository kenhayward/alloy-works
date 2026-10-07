import { z } from 'zod';

import { canonicalValueSchema, parameterName } from '../data/primitives.js';
import { parameterSchema } from '../data/definition.js';
import { checkParameterValues, type ParameterProblem } from '../data/parameters.js';
import type { CanonicalValue } from '../data/canonical.js';
import type { FieldDefinition } from '../metadata/field.js';
import type { EffectiveField } from '../metadata/resolve.js';
import type { MetadataValues } from '../metadata/values.js';

/** The most parameters a template declares (templates.md, "Declared on the template"). */
export const MAX_TEMPLATE_PARAMETERS = 50;

/**
 * A template's parameter (TPL-017, TPL-068; the TP1 plan, TP1-A): the query definition's own
 * declaration with no variation - which selects SQL, and which the strict shape refuses - plus whether
 * it may change after the document is made (TPL-021) and what it feeds: a document-level field it
 * seeds, and whether bindings may take it as an argument.
 */
export const templateParameterSchema = parameterSchema.omit({ variation: true }).extend({
  changeable: z.boolean(),
  feeds: z.strictObject({ field: z.string().min(1).optional(), arguments: z.boolean() }),
});

export type TemplateParameter = z.infer<typeof templateParameterSchema>;

/** A document's parameter values, by name: each canonical in its type, or a list of them. */
export type DocumentParameters = Readonly<
  Record<string, Exclude<CanonicalValue, null> | readonly Exclude<CanonicalValue, null>[]>
>;

const present = canonicalValueSchema.refine((value) => value !== null, 'A value is not null');

/** What a document version stores as its parameters: names to canonical values (TP1-D). */
export const documentParametersSchema = z.record(
  parameterName,
  z.union([present, z.array(present)]),
) as unknown as z.ZodType<DocumentParameters>;

/** A template parameter refused at save or creation (TP1-B), naming it and, where it seeds one, its field. */
export interface TemplateParameterProblem {
  readonly code: 'parameter_unused' | 'parameter_field';
  readonly parameter: string;
  readonly field?: string;
  readonly message: string;
}

/**
 * Whether a field can hold what a parameter gives it, unconverted (TP1-B): text to text; an integer to
 * a number; a decimal to a number whose scale, where declared, takes the decimal's, and to a whole
 * number only at scale 0; a date to a date; a time with no fraction to a time; an instant to a date and
 * time; a boolean to a boolean; a list only to a field of many, one value only to a field of one. A
 * local date-time names no instant, and a parameter is never a user.
 */
export function seedable(field: FieldDefinition, parameter: TemplateParameter): boolean {
  if ((field.multiplicity === 'many') !== parameter.list) return false;
  const { type } = parameter;
  switch (field.dataType) {
    case 'text':
      return type.base === 'text';
    case 'number': {
      if (type.base === 'integer') return true;
      if (type.base !== 'decimal') return false;
      if (field.validation.integer === true && type.scale !== 0) return false;
      return field.validation.scale === undefined || field.validation.scale >= type.scale;
    }
    case 'date':
      return type.base === 'date';
    case 'time':
      return type.base === 'time' && type.fraction === 0;
    case 'dateTime':
      return type.base === 'instant';
    case 'boolean':
      return type.base === 'boolean';
    case 'user':
      return false;
  }
}

/**
 * A template's parameters against its resolved fields (TP1-B), run when it is saved and when a document
 * is made from it, never inside resolution, so a later schema change never makes a document's values
 * unwritable: each feeds something (`parameter_unused`, TPL-068), and a seeded field is a document-level
 * effective field, not fixed, that takes the parameter's type (`parameter_field`).
 */
export function checkTemplateParameters(
  parameters: readonly TemplateParameter[],
  document: readonly EffectiveField[],
): TemplateParameterProblem[] {
  const problems: TemplateParameterProblem[] = [];
  const fields = new Map(document.map((each) => [each.field.id, each]));
  for (const parameter of parameters) {
    const { field, arguments: argues } = parameter.feeds;
    if (field === undefined && !argues) {
      problems.push({
        code: 'parameter_unused',
        parameter: parameter.name,
        message: `The parameter ${parameter.name} seeds no field and supplies no argument`,
      });
      continue;
    }
    if (field === undefined) continue;
    const effective = fields.get(field);
    const refuse = (message: string) =>
      problems.push({ code: 'parameter_field', parameter: parameter.name, field, message });
    if (effective === undefined) {
      refuse(
        `The parameter ${parameter.name} seeds ${field}, which is not a field of the document`,
      );
    } else if (effective.fixed) {
      refuse(`The parameter ${parameter.name} seeds ${effective.field.name}, which is fixed`);
    } else if (!seedable(effective.field, parameter)) {
      refuse(
        `The parameter ${parameter.name} cannot seed ${effective.field.name}: the field does not take its type`,
      );
    }
  }
  return problems;
}

/** Why a document's parameter values are refused (TP1-G, TP1-H): by name, or each value's problems. */
export type ParameterValuesRefused =
  | { readonly code: 'parameter_unknown'; readonly parameters: readonly string[] }
  | { readonly code: 'parameter_invalid'; readonly problems: readonly ParameterProblem[] };

/**
 * Values given for a template's parameters, checked (TP1-G): a name it does not declare first, which
 * `checkParameterValues` would call a type problem, then each value against its declaration (DAT-020).
 * Null where they pass.
 */
export function checkDocumentParameters(
  parameters: readonly TemplateParameter[],
  values: Readonly<Record<string, unknown>>,
): ParameterValuesRefused | null {
  const declared = new Set(parameters.map((each) => each.name));
  const unknown = Object.keys(values).filter((name) => !declared.has(name));
  if (unknown.length > 0) return { code: 'parameter_unknown', parameters: unknown };
  const problems = checkParameterValues(
    parameters,
    values as Parameters<typeof checkParameterValues>[1],
  );
  return problems.length > 0 ? { code: 'parameter_invalid', problems } : null;
}

/** The values each parameter seeds, by field (TPL-066's half): those given, for the fields fed. */
export function seededValues(
  parameters: readonly TemplateParameter[],
  values: DocumentParameters,
): MetadataValues {
  const seeded: [string, unknown][] = [];
  for (const parameter of parameters) {
    const { field } = parameter.feeds;
    if (field === undefined || !Object.hasOwn(values, parameter.name)) continue;
    seeded.push([field, values[parameter.name]]);
  }
  return Object.fromEntries(seeded);
}
