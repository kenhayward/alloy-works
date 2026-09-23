import { fileURLToPath } from 'node:url';
import {
  PUBLISHING_SCHEMA,
  PUBLISHING_SCHEMA_1,
  PUBLISHING_SCHEMA_9,
  type PublishedDocument,
  type PublishedDocument1,
} from '@alloy-works/domain';

/** Every schema `assemble` makes a published document in. */
export type PublishedSchema = (PublishedDocument | PublishedDocument1)['schema'];

/**
 * `PUBLISHING_SCHEMA` frozen at the schema this worker's newest template was written for, and the one
 * key the maps below take for it. The annotation is the whole point: the day `PUBLISHING_SCHEMA` is
 * repointed at `publishing/11`, THIS LINE stops typechecking, where a key computed from the moving
 * constant would have moved with it and left `publishing/11` read by template 10 with the typecheck
 * clean (the schema-keyed map trap, which cost three slices before it was pinned by literals in
 * `template.test.ts`). Freeze the domain's `PUBLISHING_SCHEMA_10` beside the new schema, key template
 * 10's rows by it, and re-point this at the new one.
 */
export const PUBLISHING_SCHEMA_CURRENT: 'publishing/10' = PUBLISHING_SCHEMA;

const at = (version: number) =>
  fileURLToPath(new URL(`../templates/publication/${version}/main.typ`, import.meta.url));

/**
 * The publication templates this worker compiles with (docs/design/publishing.md), by version. A
 * version is immutable: an edit is a new directory and a new number, and `template.test.ts` holds
 * each version's hash. Each reads `assemble`'s published document as data and evaluates none of it:
 * version 1 reads `publishing/1`, the first slice's document, version 2 `publishing/2`, the document
 * under a layout, version 3 `publishing/3`, the same document with a run's marks set, and version 4
 * `publishing/4`, the same again with a block that may be a list, version 5 `publishing/5`, the
 * same again with a block that may be a quotation or preformatted text, and version 6
 * `publishing/6`, the same again with a block that may be a table and the lists after the contents,
 * version 7 `publishing/7`, the same again with a block that may be a figure, version 8
 * `publishing/8`, the same again with a run that may be an image, version 9 `publishing/9`, the same
 * again with a run that may be a footnote and a table that may carry a note, and version 10
 * `publishing/10`, the same again with a run that may be a cross-reference and the labels its targets
 * carry. Versions 2 to 9 are kept although `assemble` makes none of their schemas any more: they are
 * what the publications made before a run carried its marks, before a block could be a list, before
 * one could be a quotation or preformatted text, before one could be a table, before one could be a
 * figure, before a run could be an image, and before one could be a footnote or a reference, were
 * compiled with, and a published version is a record.
 */
export const PUBLICATION_TEMPLATE = {
  1: { name: 'publication', version: 1, file: at(1) },
  2: { name: 'publication', version: 2, file: at(2) },
  3: { name: 'publication', version: 3, file: at(3) },
  4: { name: 'publication', version: 4, file: at(4) },
  5: { name: 'publication', version: 5, file: at(5) },
  6: { name: 'publication', version: 6, file: at(6) },
  7: { name: 'publication', version: 7, file: at(7) },
  8: { name: 'publication', version: 8, file: at(8) },
  9: { name: 'publication', version: 9, file: at(9) },
  10: { name: 'publication', version: 10, file: at(10) },
} as const;

/**
 * The template that reads a published document of each schema. `assemble` makes `publishing/1` only
 * for a request made before layouts, which publishes with template 1 as it would have then (Ken's
 * answer F); every request since is made under a layout, and publishes with template 10. Template 9
 * keeps its row for `publishing/9`, the schema it was written for, although nothing makes one now
 * (cross-references 2, ruling R8); no row names templates 2 to 8.
 *
 * **Every key is a frozen constant.** Until cross-references 2 the newest row was keyed by
 * `PUBLISHING_SCHEMA` itself, so repointing it moved the KEY while the value stayed where it was, and
 * `satisfies Record<PublishedSchema, ...>` could not say so, because `PublishedSchema` is derived from
 * the same constant - template 9 was left reading `publishing/10` with the typecheck clean. Keyed by
 * `PUBLISHING_SCHEMA_CURRENT`, which is annotated with its literal, a repoint now fails the typecheck
 * above; and `satisfies` checks the key set both ways, so a schema `assemble` makes with no row, or a
 * row for a schema no template here was written for, fails it too. `template.test.ts` still pins this
 * map as a LITERAL object, and `PIPELINE_VERSION` beside it.
 */
export const TEMPLATE_READING = {
  [PUBLISHING_SCHEMA_1]: 1,
  [PUBLISHING_SCHEMA_9]: 9,
  [PUBLISHING_SCHEMA_CURRENT]: 10,
} as const satisfies Record<
  PublishedSchema | typeof PUBLISHING_SCHEMA_9,
  keyof typeof PUBLICATION_TEMPLATE
>;
