/**
 * What a subject is called, as an event's label keeps it for when the original is gone (audit.md,
 * "Labels"): a component's, document's, query definition's or template's title; a definition's,
 * connection's, layout's, theme's or catalogue's name; a dataset's or asset's name where it has one; a
 * space's or group's name; a principal's display name. `row` is a version's content for an artifact,
 * and the stored row for anything else.
 */
const LABELLED_BY = {
  component: 'title',
  document: 'title',
  queryDefinition: 'title',
  template: 'title',
  publication: 'title',
  field: 'name',
  metadataSchema: 'name',
  componentType: 'name',
  connection: 'name',
  layout: 'name',
  theme: 'name',
  catalogue: 'name',
  dataset: 'name',
  asset: 'name',
  space: 'name',
  group: 'name',
  principal: 'display_name',
} as const;

export type LabelledKind = keyof typeof LABELLED_BY;

export function isLabelledKind(kind: string): kind is LabelledKind {
  return Object.hasOwn(LABELLED_BY, kind);
}

/** The label of a subject of this kind, or undefined where the row names it nothing. */
export function labelFor(
  kind: LabelledKind,
  row: { readonly [member: string]: unknown },
): string | undefined {
  const value = row[LABELLED_BY[kind]];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
