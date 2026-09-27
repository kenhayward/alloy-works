import { documentLink, nodeLink } from '../structure/links.js';

/**
 * Where a search result links (search.md, "The page"; SCH-057): by identity - the artifact's id and
 * its place's own id - to the page that shows it, never by a position. A component's block through the
 * component's page, a section through its document's node link (STR-044), a document and a publication
 * to their own pages. Null where the application has no page for the kind yet.
 */
export function resultLink(result: {
  readonly kind: string;
  readonly artifactId: string;
  readonly node: string | null;
  readonly place: string | null;
}): string | null {
  switch (result.kind) {
    case 'component': {
      const block = result.place?.startsWith('block:') ? result.place.slice('block:'.length) : null;
      return block === null
        ? `#/components/${result.artifactId}`
        : `#/components/${result.artifactId}/blocks/${encodeURIComponent(block)}`;
    }
    case 'section':
      return result.node === null
        ? documentLink(result.artifactId)
        : nodeLink(result.artifactId, result.node);
    case 'document':
      return documentLink(result.artifactId);
    case 'publication':
      return `#/publications/${result.artifactId}`;
    default:
      return null;
  }
}

const SEARCH = /^#\/search(?:\?(.*))?$/;

/** The query a `#/search` address holds - empty where it holds none - or null for another address. */
export function searchAddress(hash: string): string | null {
  const matched = SEARCH.exec(hash);
  if (!matched) return null;
  return new URLSearchParams(matched[1] ?? '').get('q') ?? '';
}

/** The address of a search for this query. */
export function searchLink(query: string): string {
  return query === '' ? '#/search' : `#/search?${new URLSearchParams({ q: query }).toString()}`;
}

const COMPONENT = /^#\/components\/([0-9a-f-]{36})(?:\/(access)|\/blocks\/([A-Za-z0-9_-]{1,64}))?$/;

/** What a `#/components/<id>...` address names: the component, its access, or one of its blocks. */
export function componentAddress(hash: string): {
  readonly component: string;
  readonly access: boolean;
  readonly block: string | null;
} | null {
  const matched = COMPONENT.exec(hash);
  if (!matched) return null;
  return { component: matched[1]!, access: matched[2] !== undefined, block: matched[3] ?? null };
}

/** Where in its entry a result matched, in words; `fields` names each field the reader may read. */
export function whereFound(
  place: string | null,
  fields: ReadonlyMap<string, string>,
): string | null {
  if (place === null) return null;
  if (place === 'title') return 'In its title';
  if (place.startsWith('block:')) return 'In its text';
  if (place.startsWith('field:')) {
    const name = fields.get(place.slice('field:'.length));
    return name === undefined ? 'In a field' : `In ${name}`;
  }
  if (place.startsWith('section:')) return 'In a starting section';
  if (place === 'description') return 'In its description';
  if (place === 'fields') return 'In the fields it groups';
  if (place === 'schemas') return 'In the schemas it assigns';
  return null;
}
