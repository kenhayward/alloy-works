import { canonicalise } from '../content/model/canonical.js';
import type { ContentDocument } from '../content/model/document.js';
import type { NotCarried } from '../metadata/carry.js';
import type { DefinitionKind, DefinitionOf } from '../metadata/migrate.js';
import {
  canonicaliseNotCarried,
  canonicaliseValues,
  type DefinitionRef,
} from '../metadata/record.js';
import type { MetadataValues } from '../metadata/values.js';
import { canonicalJson } from '../stored/canonical.js';
import { canonicaliseOutline, type OutlineDocument } from '../structure/outline.js';

/**
 * What a component version says (ADR-0024): its content, its metadata values, the values it did not
 * carry forward, and the definition versions it was written against - the component type among them.
 * Authorship is deliberately absent. Author, time, note and `revision.version` are not what a version
 * says, and a digest over them would make every version differ from the last.
 */
export type ComponentSubstance = {
  readonly kind: 'component';
  readonly content: ContentDocument;
  readonly values: MetadataValues;
  readonly notCarried: readonly NotCarried[];
  readonly definitions: readonly DefinitionRef[];
};

/** A field, metadata schema or component type version says its payload, and nothing else. */
export type DefinitionSubstance = {
  [K in DefinitionKind]: { readonly kind: K; readonly content: DefinitionOf[K] };
}[DefinitionKind];

/** A document version says its outline, and nothing else. */
export type DocumentSubstance = {
  readonly kind: 'document';
  readonly content: OutlineDocument;
};

export type VersionSubstance = ComponentSubstance | DefinitionSubstance | DocumentSubstance;

/**
 * The version of the one component type a component version was written against. `definitionsFor`
 * always names exactly one; anything else is a caller's bug, and a version recording it would say
 * nothing true about its type.
 */
export function componentTypeOf(definitions: readonly DefinitionRef[]): string {
  const types = definitions.filter((each) => each.kind === 'componentType');
  const [type] = types;
  if (types.length !== 1 || type === undefined) {
    throw new Error(`A component version records one component type, not ${types.length}`);
  }
  return type.version;
}

/**
 * The canonical content alone: the input to `content_hash`, which keys derived data. A component's
 * content takes the content model's rules, where marks are a set; a document's outline takes the same
 * rule, because a section title is inline content too; a definition's payload takes the shared rules,
 * where no array is.
 *
 * The content is serialised as it is handed in and never migrated, because a digest is over what was
 * written. Recomputing one from a stored row passes the row's content exactly as stored.
 */
export function canonicaliseVersionContent(substance: VersionSubstance): string {
  if (substance.kind === 'component') return canonicalise(substance.content);
  // A section title is inline content and marks are a set, so an outline takes the content model's
  // rule too. The shared rule below is for a definition's payload, where no array is a set.
  if (substance.kind === 'document') return canonicaliseOutline(substance.content);
  return canonicalJson(substance.content);
}

/**
 * The canonical serialisation of the whole version: the input to the version digest (ADR-0024,
 * VER-042), which decides whether a version changed.
 *
 * One canonical JSON document of five members in lexicographic order - `componentType`, `content`,
 * `definitions`, `notCarried`, `values` - composed from each member's own canonical form rather than
 * by serialising one object, because content's rule that `marks` is a set must not reach a metadata
 * field whose identifier happens to be `marks` (MET-030). A definition version holds the same five
 * members, with no type, no definitions and no values, so every row's digest has one shape.
 */
export function canonicaliseVersion(substance: VersionSubstance): string {
  const component = substance.kind === 'component' ? substance : undefined;
  const members: readonly (readonly [string, string])[] = [
    ['componentType', canonicalJson(component ? componentTypeOf(component.definitions) : null)],
    ['content', canonicaliseVersionContent(substance)],
    ['definitions', canonicaliseDefinitions(component?.definitions ?? [])],
    ['notCarried', canonicaliseNotCarried(component?.notCarried ?? [])],
    ['values', canonicaliseValues(component?.values ?? {})],
  ];
  return `{${members.map(([name, value]) => `${JSON.stringify(name)}:${value}`).join(',')}}`;
}

/** The definitions a version records are a set: sorted by kind, identifier and version. */
function canonicaliseDefinitions(definitions: readonly DefinitionRef[]): string {
  const seen = new Set<string>();
  for (const each of definitions) {
    const key = `${each.kind} ${each.id}`;
    if (seen.has(key)) throw new Error(`The definition ${key} is recorded twice`);
    seen.add(key);
  }
  return canonicalJson(
    [...definitions].sort(
      (a, b) => compare(a.kind, b.kind) || compare(a.id, b.id) || compare(a.version, b.version),
    ),
  );
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
