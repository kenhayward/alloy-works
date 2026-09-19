import { fileURLToPath } from 'node:url';

/**
 * The publication template this worker compiles with (docs/design/publishing.md). A version is
 * immutable: an edit is a new directory and a new number, and `template.test.ts` holds each version's
 * hash. It reads `publishing/1` - `assemble`'s published document - as data and evaluates none of it.
 */
export const PUBLICATION_TEMPLATE = {
  name: 'publication',
  version: 1,
  file: fileURLToPath(new URL('../templates/publication/1/main.typ', import.meta.url)),
} as const;
