/** A detail page's tab, after its id (ADR-0050, decision 2): lower case words joined by hyphens. */
const TAB = '(?:\\/([a-z]+(?:-[a-z]+)*))?';

const CONNECTION = new RegExp(`^#\\/connections\\/([0-9a-f-]{36})${TAB}$`);

/**
 * A connection's own page at a tab (null for the first), or its access page, as a
 * `#/connections/<id>[/<tab>]` address names it; or null.
 */
export function connectionAddress(hash: string): {
  readonly connection: string;
  readonly access: boolean;
  readonly tab: string | null;
} | null {
  const match = CONNECTION.exec(hash);
  if (!match) return null;
  const access = match[2] === 'access';
  return { connection: match[1]!, access, tab: access ? null : (match[2] ?? null) };
}

/** The address of a connection's own page, at a tab or its first. */
export function connectionLink(connection: string, tab?: string): string {
  return `#/connections/${connection}${tab === undefined ? '' : `/${tab}`}`;
}

/** The address of a connection's access page. */
export function connectionAccessLink(connection: string): string {
  return `#/connections/${connection}/access`;
}

/** The address at which a new query definition is written. */
export const NEW_QUERY_DEFINITION = '#/query-definitions/new';

const QUERY_DEFINITION = new RegExp(`^#\\/query-definitions\\/(new|[0-9a-f-]{36})${TAB}$`);

/**
 * What a `#/query-definitions/...` address names: a definition by id, or `new` for one being written;
 * or null for any other address.
 */
export function queryDefinitionAddress(hash: string): string | null {
  return QUERY_DEFINITION.exec(hash)?.[1] ?? null;
}

/** The tab a query definition's address names, or null for its first. */
export function queryDefinitionTab(hash: string): string | null {
  return QUERY_DEFINITION.exec(hash)?.[2] ?? null;
}

/** The address of a query definition's own page, at a tab or its first. */
export function queryDefinitionLink(definition: string, tab?: string): string {
  return `#/query-definitions/${definition}${tab === undefined ? '' : `/${tab}`}`;
}
