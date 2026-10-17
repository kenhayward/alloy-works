import { baselineLink, documentLink, documentVersionLink, nodeLink } from '../structure/links.js';

/** A version a result names (SV-G). */
interface ResultVersion {
  readonly id: string;
  readonly latest: boolean;
}

/** The address of one version of a component, read only, and a block in it (SCH-058). */
export function componentVersionLink(component: string, version: string, block?: string): string {
  return `#/components/${component}/versions/${version}${
    block === undefined ? '' : `/blocks/${encodeURIComponent(block)}`
  }`;
}

/**
 * Where a search result links (search.md, "The page"; SCH-057): by identity - the artifact's id and
 * its place's own id - to the page that shows it, never by a position. A component's block through the
 * component's page, a section through its document's node link (STR-044), a document and a publication
 * to their own pages. A result from an earlier version opens that version's page (SCH-058), and one
 * found in a baseline the baseline's, at its node. Null where the application has no page for the kind
 * yet.
 */
export function resultLink(result: {
  readonly kind: string;
  readonly artifactId: string;
  readonly node: string | null;
  readonly place: string | null;
  readonly version?: ResultVersion | null;
  readonly baseline?: {
    readonly id: string;
    readonly name?: string;
    readonly document: string;
    readonly node: string | null;
  } | null;
  readonly thread?: {
    readonly id: string;
    readonly on: 'component' | 'document';
    readonly resolved?: boolean;
  } | null;
}): string | null {
  const block = result.place?.startsWith('block:') ? result.place.slice('block:'.length) : null;
  if (result.baseline) {
    return result.kind === 'asset'
      ? null
      : baselineLink(
          result.baseline.document,
          result.baseline.id,
          result.baseline.node ?? undefined,
        );
  }
  const earlier = result.version && !result.version.latest ? result.version.id : null;
  switch (result.kind) {
    case 'component':
      if (earlier !== null) {
        return componentVersionLink(result.artifactId, earlier, block ?? undefined);
      }
      return block === null
        ? `#/components/${result.artifactId}`
        : `#/components/${result.artifactId}/blocks/${encodeURIComponent(block)}`;
    case 'section':
      if (earlier !== null) {
        return documentVersionLink(result.artifactId, earlier, result.node ?? undefined);
      }
      return result.node === null
        ? documentLink(result.artifactId)
        : nodeLink(result.artifactId, result.node);
    case 'document':
      return earlier === null
        ? documentLink(result.artifactId)
        : documentVersionLink(result.artifactId, earlier);
    case 'publication':
      return `#/publications/${result.artifactId}`;
    case 'queryDefinition':
      return `#/query-definitions/${result.artifactId}`;
    case 'thread':
      return result.thread
        ? threadLink(
            { kind: result.thread.on, id: result.artifactId },
            result.thread.id,
            result.place?.startsWith('message:') ? result.place.slice('message:'.length) : null,
          )
        : null;
    default:
      return null;
  }
}

/** What a thread is on, by its kind and id. */
export interface ThreadOn {
  readonly kind: 'component' | 'document';
  readonly id: string;
}

/** The address of a thread, and a message in it (the SV plan, SV-M; SCH-071). */
export function threadLink(on: ThreadOn, thread: string, comment: string | null = null): string {
  return `#/${on.kind}s/${on.id}/threads/${thread}${comment === null ? '' : `/comments/${comment}`}`;
}

const THREAD =
  /^#\/(component|document)s\/([0-9a-f-]{36})\/threads\/([0-9a-f-]{36})(?:\/comments\/([0-9a-f-]{36}))?$/;

/** What a thread's address names: what it is on, the thread, and a message in it; or null. */
export function threadAddress(hash: string): {
  readonly on: ThreadOn;
  readonly thread: string;
  readonly comment: string | null;
} | null {
  const matched = THREAD.exec(hash);
  if (!matched) return null;
  return {
    on: { kind: matched[1] as ThreadOn['kind'], id: matched[2]! },
    thread: matched[3]!,
    comment: matched[4] ?? null,
  };
}

const SEARCH = /^#\/search(?:\?(.*))?$/;

/** The query a `#/search` address holds - empty where it holds none - or null for another address. */
export function searchAddress(hash: string): string | null {
  const matched = SEARCH.exec(hash);
  if (!matched) return null;
  return new URLSearchParams(matched[1] ?? '').get('q') ?? '';
}

/** Which versions a search reads: the latest, every version, or what one baseline pins (SV-I). */
export interface SearchScope {
  readonly versions: 'latest' | 'all';
  readonly baseline: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The scope a `#/search` address holds; the latest where it holds none. A baseline wins over all. */
export function searchScope(hash: string): SearchScope {
  const params = new URLSearchParams(SEARCH.exec(hash)?.[1] ?? '');
  const baseline = params.get('baseline');
  if (baseline !== null && UUID.test(baseline)) return { versions: 'latest', baseline };
  return { versions: params.get('versions') === 'all' ? 'all' : 'latest', baseline: null };
}

/** The address of a search for this query, in this scope. */
export function searchLink(query: string, scope?: SearchScope): string {
  const params = new URLSearchParams();
  if (query !== '') params.set('q', query);
  if (scope?.baseline) params.set('baseline', scope.baseline);
  else if (scope?.versions === 'all') params.set('versions', 'all');
  const said = params.toString();
  return said === '' ? '#/search' : `#/search?${said}`;
}

const COMPONENT =
  /^#\/components\/([0-9a-f-]{36})(?:\/(access)|\/versions\/([0-9a-f-]{36})|\/lines\/([0-9a-f-]{36}))?(?:\/blocks\/([A-Za-z0-9_-]{1,64}))?$/;

/**
 * What a `#/components/<id>...` address names: the component, its access, one of its blocks, or one of
 * its versions read only (SCH-058) and a block in it.
 */
export function componentAddress(hash: string): {
  readonly component: string;
  readonly access: boolean;
  readonly block: string | null;
  readonly version: string | null;
  /** A divergent line it is opened on (LIF-046; the R16 plan, R16-E). */
  readonly line?: string;
} | null {
  const matched = COMPONENT.exec(hash);
  if (!matched) return null;
  const access = matched[2] !== undefined;
  const block = matched[5] ?? null;
  if (access && block !== null) return null;
  return {
    component: matched[1]!,
    access,
    block,
    version: matched[3] ?? null,
    ...(matched[4] === undefined ? {} : { line: matched[4] }),
  };
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
  if (place === 'columns') return 'In its column names';
  if (place.startsWith('message:')) return 'In a message';
  if (place === 'anchor') return 'In the text it is on';
  return null;
}
