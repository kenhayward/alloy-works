import { readCatalogue, type CatalogueReadOutcome, type ThemeRefusal } from './read.js';
import type { Catalogue } from './schema.js';

/**
 * **A catalogue as a document** (the SY plan, SY-I; STY-043): its JSON as its schema states it, in a
 * wrapper naming the format and its version, so a house style moves between themes and environments.
 * Reading one back reads the catalogue by `readCatalogue`, every refusal at once and each by where it
 * is, so nothing it cannot represent is dropped (STY-044). Whether it fits a theme - its typefaces,
 * the styles its places name - is the theme reader's, at import (STY-071).
 */
export const CATALOGUE_DOCUMENT_FORMAT = 'alloy-works.catalogue';
export const CATALOGUE_DOCUMENT_VERSION = 1;

export interface CatalogueDocument {
  readonly format: typeof CATALOGUE_DOCUMENT_FORMAT;
  readonly version: typeof CATALOGUE_DOCUMENT_VERSION;
  readonly catalogue: Catalogue;
}

/** A stored catalogue as a document, at the schema it reads at now: what a reader of today imports. */
export function exportCatalogue(stored: unknown): CatalogueDocument {
  const read = readCatalogue(stored);
  if (!read.ok) throw new Error(read.refusals.map((each) => each.message).join('; '));
  return {
    format: CATALOGUE_DOCUMENT_FORMAT,
    version: CATALOGUE_DOCUMENT_VERSION,
    catalogue: read.catalogue,
  };
}

const malformed = (message: string): { ok: false; refusals: ThemeRefusal[] } => ({
  ok: false,
  refusals: [{ code: 'catalogue_malformed', message }],
});

export function readCatalogueDocument(document: unknown): CatalogueReadOutcome {
  const held = (typeof document === 'object' && document !== null ? document : {}) as Record<
    string,
    unknown
  >;
  if (held['format'] !== CATALOGUE_DOCUMENT_FORMAT) {
    return malformed('The document is not an Alloy Works catalogue: it names no format of ours');
  }
  if (held['version'] !== CATALOGUE_DOCUMENT_VERSION) {
    return malformed(
      `The document is a catalogue at version ${String(held['version'])}, and this reads version ${CATALOGUE_DOCUMENT_VERSION}`,
    );
  }
  return readCatalogue(held['catalogue']);
}
