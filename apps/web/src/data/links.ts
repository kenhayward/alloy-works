const CONNECTION = /^#\/connections\/([0-9a-f-]{36})(\/access)?$/;

/** A connection's own page, or its access page, as a `#/connections/<id>` address names it; or null. */
export function connectionAddress(
  hash: string,
): { readonly connection: string; readonly access: boolean } | null {
  const match = CONNECTION.exec(hash);
  return match ? { connection: match[1]!, access: match[2] !== undefined } : null;
}

/** The address of a connection's own page. */
export function connectionLink(connection: string): string {
  return `#/connections/${connection}`;
}

/** The address of a connection's access page. */
export function connectionAccessLink(connection: string): string {
  return `#/connections/${connection}/access`;
}
