/**
 * Every rule a metadata failure can name. The first six are validation's (metadata.md, Validation);
 * `user` is `checkUserValues`'; `default`, `requires` and `defaultConflict` are failures of a
 * definition rather than of a value, found by `checkSchema` and `checkAssignment`.
 */
export type MetadataRule =
  | 'required'
  | 'fixed'
  | 'type'
  | 'multiplicity'
  | 'maxValues'
  | 'minLength'
  | 'maxLength'
  | 'min'
  | 'max'
  | 'integer'
  | 'scale'
  | 'user'
  | 'default'
  | 'requires'
  | 'defaultConflict';

/**
 * MET-022. `code` is stable, so the editor, the service and the publisher report one failure the same
 * way. `schemas` lists every schema that imposed the rule, and is empty for a rule that is the field's
 * alone (MET-004). The artifact is the caller's to add: nothing here knows which artifact it is.
 */
export type MetadataFailure = {
  readonly code: `metadata.${MetadataRule}`;
  readonly field: string;
  readonly rule: MetadataRule;
  readonly schemas: readonly string[];
  readonly detail: string;
};

export function failure(
  field: string,
  rule: MetadataRule,
  detail: string,
  schemas: readonly string[] = [],
): MetadataFailure {
  return { code: `metadata.${rule}`, field, rule, schemas: [...schemas], detail };
}
