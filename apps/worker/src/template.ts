import { fileURLToPath } from 'node:url';
import {
  PUBLISHING_SCHEMA,
  PUBLISHING_SCHEMA_1,
  type PublishedDocument,
  type PublishedDocument1,
} from '@alloy-works/domain';

/** Every schema `assemble` makes a published document in. */
export type PublishedSchema = (PublishedDocument | PublishedDocument1)['schema'];

const at = (version: number) =>
  fileURLToPath(new URL(`../templates/publication/${version}/main.typ`, import.meta.url));

/**
 * The publication templates this worker compiles with (docs/design/publishing.md), by version. A
 * version is immutable: an edit is a new directory and a new number, and `template.test.ts` holds
 * each version's hash. Each reads `assemble`'s published document as data and evaluates none of it:
 * version 1 reads `publishing/1`, the first slice's document, version 2 `publishing/2`, the document
 * under a layout, version 3 `publishing/3`, the same document with a run's marks set, and version 4
 * `publishing/4`, the same again with a block that may be a list, and version 5 `publishing/5`, the
 * same again with a block that may be a quotation or preformatted text. Versions 2, 3 and 4 are kept
 * although `assemble` makes none of their schemas any more: they are what the publications made
 * before a run carried its marks, before a block could be a list, and before one could be a
 * quotation or preformatted text, were compiled with, and a published version is a record.
 */
export const PUBLICATION_TEMPLATE = {
  1: { name: 'publication', version: 1, file: at(1) },
  2: { name: 'publication', version: 2, file: at(2) },
  3: { name: 'publication', version: 3, file: at(3) },
  4: { name: 'publication', version: 4, file: at(4) },
  5: { name: 'publication', version: 5, file: at(5) },
} as const;

/**
 * The template that reads a published document of each schema. `assemble` makes `publishing/1` only
 * for a request made before layouts, which publishes with template 1 as it would have then (Ken's
 * answer F); every request since is made under a layout, and publishes with template 5. No row names
 * template 2, 3 or 4, because nothing makes a document of their schemas to hand them.
 *
 * **Both keys are computed, and that is the hazard this map carries.** Repoint `PUBLISHING_SCHEMA`
 * and the KEY moves while the value stays where it was, and `satisfies Record<PublishedSchema, ...>`
 * cannot say so, because `PublishedSchema` is derived from the same constant. `template.test.ts`
 * pins this map as a LITERAL object for that reason, and `PIPELINE_VERSION` beside it.
 */
export const TEMPLATE_READING = {
  [PUBLISHING_SCHEMA_1]: 1,
  [PUBLISHING_SCHEMA]: 5,
} as const satisfies Record<PublishedSchema, keyof typeof PUBLICATION_TEMPLATE>;
