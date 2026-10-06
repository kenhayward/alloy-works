import type { DraftDefinition } from './definition.js';
import { generatePostgres } from './generate.js';
import type { ParameterValues } from './parameters.js';
import { BindingRefused, bindPostgres, type BoundStatement } from './sql.js';

/**
 * A definition's fetch bound to its values, by its kind (the D4 plan, D4-H, D4-Q): SQL by D2's binder,
 * the same statement whichever is asked for; a built query by the generator, its shape or its run.
 * The one function a run, a describe and a sample bind through. Throws `BindingRefused` where the
 * text, read back, does not hold exactly its placeholders.
 */
export function bindFetch(
  definition: Pick<DraftDefinition, 'parameters' | 'fetch' | 'columns' | 'order'>,
  values: ParameterValues,
  statement: 'shape' | 'run' = 'run',
): BoundStatement {
  const { fetch } = definition;
  if (fetch.kind === 'sql')
    return bindPostgres({ parameters: definition.parameters, fetch }, values);
  // An HTTP request is a database's never: it is placed by `bindHttp`, position by position (D6-A).
  if (fetch.kind === 'http') throw new BindingRefused();
  return generatePostgres({ ...definition, fetch }, values, statement);
}
