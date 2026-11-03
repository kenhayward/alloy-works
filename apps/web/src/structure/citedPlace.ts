/**
 * Where a citation goes: the node placing its part in this document, else that part's own page, as a
 * part read from outside the document has no place here to mark.
 */
export function citedPlace(
  component: string,
  componentOfNode: ReadonlyMap<string, string>,
): { readonly node: string } | { readonly href: string } {
  const placed = [...componentOfNode].find(([, each]) => each === component);
  return placed === undefined ? { href: `#/components/${component}` } : { node: placed[0] };
}
