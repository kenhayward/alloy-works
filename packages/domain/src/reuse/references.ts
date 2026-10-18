/**
 * One reference a version holds, as the reference index keeps it (relationships.md, "References";
 * the R2 plan, R2-A): the node holding it, where it has one, and what it names. An image names an
 * asset **version**, which the index resolves to its asset; everything else names an artifact.
 */
export interface IndexedReference {
  readonly node: string | null;
  readonly target:
    | {
        readonly artifact: string;
        readonly kind: 'component' | 'queryDefinition' | 'connection' | 'dataset';
      }
    | { readonly version: string; readonly kind: 'asset' };
  /** `latest` follows each version, `approved` each approved revision, `pinned` one version. */
  readonly mode: 'latest' | 'approved' | 'pinned';
  /** The version pinned, where one is and the target names an artifact. */
  readonly version?: string;
}

type Json = Readonly<Record<string, unknown>>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** Every object in a value, depth first, in the order the value holds them. */
function* objectsIn(value: unknown): Generator<Json> {
  if (Array.isArray(value)) for (const member of value) yield* objectsIn(member);
  else if (isObject(value)) {
    yield value;
    for (const member of Object.values(value)) yield* objectsIn(member);
  }
}

/**
 * The references a version of this kind holds, in content order: a document's to components, a
 * component's to asset versions (figures and images) and query definitions (bindings), and a query
 * definition's to its connection. Read from the stored content, which its writer has checked; a
 * document's template is not in its content, and the index adds it.
 */
export function referencesIn(kind: string, content: unknown): IndexedReference[] {
  const found: IndexedReference[] = [];
  if (kind === 'document') {
    for (const node of objectsIn(content)) {
      const component = text(node['component']);
      if (node['type'] !== 'reference' || component === undefined || !isObject(node['mode'])) {
        continue;
      }
      const mode = node['mode']['kind'];
      const version = text(node['mode']['version']);
      if (mode !== 'latest' && mode !== 'approved' && mode !== 'pinned') continue;
      found.push({
        node: text(node['id']) ?? null,
        target: { artifact: component, kind: 'component' },
        mode,
        ...(mode === 'pinned' && version !== undefined ? { version } : {}),
      });
    }
  } else if (kind === 'component') {
    for (const node of objectsIn(content)) {
      const asset = text(node['asset']);
      if ((node['type'] === 'figure' || node['type'] === 'image') && asset !== undefined) {
        found.push({
          node: text(node['id']) ?? null,
          target: { version: asset, kind: 'asset' },
          mode: 'pinned',
        });
      }
      const query = text(node['query']);
      if (node['type'] === 'binding' && query !== undefined) {
        const version = text(node['version']);
        found.push({
          node: text(node['id']) ?? null,
          target: { artifact: query, kind: 'queryDefinition' },
          mode: version === undefined ? 'latest' : 'pinned',
          ...(version === undefined ? {} : { version }),
        });
      }
    }
  } else if (kind === 'queryDefinition' && isObject(content)) {
    const connection = text(content['connection']);
    if (connection !== undefined) {
      found.push({
        node: null,
        target: { artifact: connection, kind: 'connection' },
        mode: 'latest',
      });
    }
    // A stored result it queries as its source (R21-A), at the version it pins or its latest.
    const fetch = content['fetch'];
    if (isObject(fetch) && fetch['kind'] === 'dataset') {
      const dataset = text(fetch['dataset']);
      const version = text(fetch['version']);
      if (dataset !== undefined) {
        found.push({
          node: null,
          target: { artifact: dataset, kind: 'dataset' },
          mode: version === undefined ? 'latest' : 'pinned',
          ...(version === undefined ? {} : { version }),
        });
      }
    }
  }
  return found;
}
