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
 * version 1 reads `publishing/1`, the first slice's document, and version 2 `publishing/2`, the
 * document under a layout.
 */
export const PUBLICATION_TEMPLATE = {
  1: { name: 'publication', version: 1, file: at(1) },
  2: { name: 'publication', version: 2, file: at(2) },
} as const;

/**
 * The template that reads a published document of each schema. `assemble` makes `publishing/1` only
 * for a request made before layouts, which publishes with template 1 as it would have then (Ken's
 * answer F); every request since is made under a layout, and publishes with template 2.
 */
export const TEMPLATE_READING = {
  [PUBLISHING_SCHEMA_1]: 1,
  [PUBLISHING_SCHEMA]: 2,
} as const satisfies Record<PublishedSchema, keyof typeof PUBLICATION_TEMPLATE>;
