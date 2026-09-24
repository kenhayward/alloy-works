import { fileURLToPath } from 'node:url';
import {
  PUBLISHING_SCHEMA,
  PUBLISHING_SCHEMA_1,
  PUBLISHING_SCHEMA_9,
  PUBLISHING_SCHEMA_10,
  PUBLISHING_SCHEMA_11,
  PUBLISHING_SCHEMA_12,
  type PublishedDocument,
  type PublishedDocument1,
} from '@alloy-works/domain';

/** Every schema `assemble` makes a published document in. */
export type PublishedSchema = (PublishedDocument | PublishedDocument1)['schema'];

/**
 * `PUBLISHING_SCHEMA` frozen at the schema this worker's newest template was written for, and the one
 * key the maps below take for it. The annotation is the whole point: the day `PUBLISHING_SCHEMA` is
 * repointed at `publishing/14`, THIS LINE stops typechecking, where a key computed from the moving
 * constant would have moved with it and left `publishing/14` read by template 13 with the typecheck
 * clean (the schema-keyed map trap, which cost three slices before it was pinned by literals in
 * `template.test.ts`). Freeze the domain's `PUBLISHING_SCHEMA_13` beside the new schema, key template
 * 13's rows by it, and re-point this at the new one - as themes 1 did for `publishing/11` and themes 2
 * for `publishing/12`.
 */
export const PUBLISHING_SCHEMA_CURRENT: 'publishing/13' = PUBLISHING_SCHEMA;

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
 * again with a run that may be a footnote and a table that may carry a note, version 10
 * `publishing/10`, the same again with a run that may be a cross-reference and the labels its targets
 * carry, version 11 `publishing/11`, the same again with a run and a block that may be an
 * equation, set in the pinned maths face, and a node's title that is runs, version 12
 * `publishing/12`, the same again set from its theme, and version 13 `publishing/13`, the same again
 * with its tables and images set from their styles. Versions 2 to 12 are kept although `assemble`
 * makes none of their schemas any more: they are what the publications made before a run carried
 * its marks, before a block could be a list, before one could be a quotation or preformatted text,
 * before one could be a table, before one could be a figure, before a run could be an image, before
 * one could be a footnote or a reference, before one could be an equation, before a publication
 * was set from a theme, and before a table and an image were set from their styles, were compiled
 * with, and a published version is a record.
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
  11: { name: 'publication', version: 11, file: at(11) },
  // Themes 1 repointed `PUBLISHING_SCHEMA` at `publishing/12`, and the guard above asked for this row:
  // template 12, which sets every face, size, colour, space and line from the document's theme.
  12: { name: 'publication', version: 12, file: at(12) },
  // Themes 2 repointed `PUBLISHING_SCHEMA` at `publishing/13`, and the guard above asked for this row:
  // template 13, which sets a table's rules, fills, inset, header and breaks, a figure's placement, and
  // the contextual spacing between paragraphs from the theme too.
  13: { name: 'publication', version: 13, file: at(13) },
} as const;

/**
 * The template that reads a published document of each schema. `assemble` makes `publishing/1` only
 * for a request made before layouts, which publishes with template 1 as it would have then (Ken's
 * answer F); every request since is made under a layout and a theme, and publishes with template 13,
 * the one themes 2 writes. Templates 9 to 12 keep their rows for `publishing/9` to `publishing/12`, the
 * schemas they were written for, although nothing makes any of them now (cross-references 2, ruling
 * R8; equations 2; themes 1; themes 2); no row names templates 2 to 8.
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
  [PUBLISHING_SCHEMA_10]: 10,
  [PUBLISHING_SCHEMA_11]: 11,
  [PUBLISHING_SCHEMA_12]: 12,
  [PUBLISHING_SCHEMA_CURRENT]: 13,
} as const satisfies Record<
  | PublishedSchema
  | typeof PUBLISHING_SCHEMA_9
  | typeof PUBLISHING_SCHEMA_10
  | typeof PUBLISHING_SCHEMA_11
  | typeof PUBLISHING_SCHEMA_12,
  keyof typeof PUBLICATION_TEMPLATE
>;
