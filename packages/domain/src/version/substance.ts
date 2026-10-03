import { canonicalise, marksAsASet } from '../content/model/canonical.js';
import type { ContentDocument } from '../content/model/document.js';
import type { NotCarried } from '../metadata/carry.js';
import type { DefinitionKind, DefinitionOf } from '../metadata/migrate.js';
import {
  canonicaliseNotCarried,
  canonicaliseValues,
  type DefinitionRef,
} from '../metadata/record.js';
import type { MetadataValues } from '../metadata/values.js';
import type { AssetVersionContent } from '../assets/version.js';
import type { Layout } from '../publishing/layout.js';
import { canonicalJson } from '../stored/canonical.js';
import { canonicaliseOutline, type OutlineDocument } from '../structure/outline.js';
import type { TemplateDefinition } from '../template/definition.js';
import type { Catalogue, Catalogue1, Theme } from '../theme/schema.js';
import type { ConnectionSettings } from '../data/connection.js';
import type { QueryDefinition } from '../data/definition.js';
import type { Provenance } from '../data/provenance.js';

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

/**
 * A document version says its outline, and the values of the fields its template applies to it
 * (templates.md, "Values"). A document made blank, or before templates, has none, and says so by
 * leaving `values` out or empty alike: both serialise as the empty object its digest was taken over.
 */
export type DocumentSubstance = {
  readonly kind: 'document';
  readonly content: OutlineDocument;
  readonly values?: MetadataValues;
};

/**
 * A layout version says its layout, and nothing else. Its content takes the shared rule, as a
 * definition's payload does: no array in a layout is a set, and a slot's parts are in the order set.
 */
export type LayoutSubstance = { readonly kind: 'layout'; readonly content: Layout };

/**
 * An asset version says its recorded properties and its default description, and nothing else
 * (docs/design/assets.md). Its content takes the shared rule, as a layout's does: nothing in it is a set.
 */
export type AssetSubstance = { readonly kind: 'asset'; readonly content: AssetVersionContent };

/**
 * A theme version says its theme, and nothing else (themes 1, ruling R4): its catalogues are named in it
 * by version, so the one digest covers what it binds. It takes the shared rule, as a layout does: a
 * theme's typefaces and a typeface's files are in the order stated, and no array in it is a set.
 */
export type ThemeSubstance = { readonly kind: 'theme'; readonly content: Theme };

/**
 * A catalogue version says its catalogue, and nothing else, at the version it was written at: a
 * `catalogue/1` row, the default theme's 0.1 among them, is digested as it is held, never as the reader
 * upgrades it. The shared rule again: a catalogue's styles are in catalogue order, which is the order a
 * projection writes them in.
 */
export type CatalogueSubstance = {
  readonly kind: 'catalogue';
  readonly content: Catalogue | Catalogue1;
};

/**
 * A template version says its definition, and nothing else (templates.md): the outline it owns and the
 * references it makes, all in its payload. Its starting sections' titles are inline content, whose
 * marks are a set, so it is canonicalised with the content model's rule for them, as an outline is.
 */
export type TemplateSubstance = { readonly kind: 'template'; readonly content: TemplateDefinition };

/**
 * A connection version says its settings, and nothing else (data.md, "The connection"): what anybody
 * who may read it sees, never a secret. The shared rule: it holds no array and no `marks`.
 */
export type ConnectionSubstance = {
  readonly kind: 'connection';
  readonly content: ConnectionSettings;
};

/**
 * A query definition version says its definition, and nothing else (data.md, "What a query definition
 * version holds"). The shared rule: its arrays - parameters, variations, columns, key, order - keep
 * their order, which is part of their meaning, and no member in it is named by its author (D2-E), so
 * no name-keyed rule can reach one. Its strings are NFC already (D2-F).
 */
export type QueryDefinitionSubstance = {
  readonly kind: 'queryDefinition';
  readonly content: QueryDefinition;
};

/**
 * A dataset version says its provenance record, and nothing else (data.md, "Storage of results and
 * provenance"; DAT-085): the result is an object under its checksum, never in the version. The shared
 * rule: its columns keep their order, and its parameters' lists theirs, which no set rule reaches.
 */
export type DatasetSubstance = { readonly kind: 'dataset'; readonly content: Provenance };

export type VersionSubstance =
  | ComponentSubstance
  | DatasetSubstance
  | ConnectionSubstance
  | QueryDefinitionSubstance
  | TemplateSubstance
  | DefinitionSubstance
  | DocumentSubstance
  | LayoutSubstance
  | AssetSubstance
  | ThemeSubstance
  | CatalogueSubstance;

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
 * rule, because a section title is inline content too; a definition's payload and a layout take the
 * shared rules, where no array is.
 *
 * The content is serialised as it is handed in and never migrated, because a digest is over what was
 * written. Recomputing one from a stored row passes the row's content exactly as stored.
 */
export function canonicaliseVersionContent(substance: VersionSubstance): string {
  if (substance.kind === 'component') return canonicalise(substance.content);
  // A section title is inline content and marks are a set, so an outline takes the content model's
  // rule too. The shared rule below is for a definition's payload, where no array is a set.
  if (substance.kind === 'document') return canonicaliseOutline(substance.content);
  // Only a starting title holds a `marks` array in a template, so the rule reaches nothing else.
  if (substance.kind === 'template') return canonicalJson(substance.content, marksAsASet);
  return canonicalJson(substance.content);
}

/**
 * The canonical serialisation of the whole version: the input to the version digest (ADR-0024,
 * VER-042), which decides whether a version changed.
 *
 * One canonical JSON document of five members in lexicographic order - `componentType`, `content`,
 * `definitions`, `notCarried`, `values` - composed from each member's own canonical form rather than
 * by serialising one object, because content's rule that `marks` is a set must not reach a metadata
 * field whose identifier happens to be `marks` (MET-030). A document version holds its values and
 * nothing else of the three; a definition version holds the same five members, with no type, no
 * definitions and no values, so every row's digest has one shape.
 */
export function canonicaliseVersion(substance: VersionSubstance): string {
  const component = substance.kind === 'component' ? substance : undefined;
  const values =
    component?.values ?? (substance.kind === 'document' ? substance.values : undefined);
  const members: readonly (readonly [string, string])[] = [
    ['componentType', canonicalJson(component ? componentTypeOf(component.definitions) : null)],
    ['content', canonicaliseVersionContent(substance)],
    ['definitions', canonicaliseDefinitions(component?.definitions ?? [])],
    ['notCarried', canonicaliseNotCarried(component?.notCarried ?? [])],
    ['values', canonicaliseValues(values ?? {})],
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
