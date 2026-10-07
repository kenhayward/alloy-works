import {
  bindingDigestInput,
  bindingsIn,
  missingSections,
  parseProvenance,
  parseAssetVersion,
  parseOutputReport,
  PUBLISHING_FORMATS,
  readContent,
  readLayout,
  readOutline,
  speaksFor,
  unsupportedFormats,
  valueFailures,
  walkOutline,
  type ContentDocument,
  type Layout,
  type MissingSection,
  type NodeFailure,
  type NumberingTable,
  type OutlineDocument,
  type OutputReport,
  type PublishFailure,
  type PublishingAsset,
  type PublishingFormat,
  type ResolvedTheme,
  type BlockNode,
  type InlineNode,
  type UnresolvedReference,
  readDefinition,
  resolveComponentFields,
  validate,
  type DefinitionOf,
  type HeldDataset,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { readableComponents } from './documents.js';
import { enqueueJob } from './queue.js';
import { readableArtifacts } from './readable-artifacts.js';
import {
  checkedLimit,
  countOf,
  facetOf,
  isListingRequest,
  keysetPage,
  listingSorts,
  snapshotFor,
  sortColumns,
  visibleIn,
  type FacetCount,
  type Listed,
  type ListingRequest,
  type SortOf,
} from './listing.js';
import { indexPublication } from './search.js';
import type { TenantTransaction } from './tables.js';
import { documentLayout, documentRules, documentTheme } from './templates.js';
import { themeAt } from './themes.js';
import { sha256Hex } from './version-digest.js';
import { headingOf, latestVersion, readVersion, type VersionHeading } from './versions.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What resolving one occurrence came to, as its publisher: the version it takes, or why none. */
export type OccurrenceOutcome =
  | {
      readonly node: string;
      readonly outcome: 'resolved';
      readonly component: string;
      readonly version: string;
    }
  | { readonly node: string; readonly outcome: 'unreadable' }
  | { readonly node: string; readonly outcome: 'unresolved' };

/**
 * Every reference in the outline resolved as one principal (decision C; PUB-094, issue #143): `latest`
 * to the component's head, `pinned` to its pin. **A component the principal may not read is never
 * read** - both version queries are restricted to the readable set in the query itself, as
 * `numberingInputs`' are - and its occurrence is `unreadable`, as is one naming no component at all,
 * so the answer cannot tell the two apart. `approved` resolves to nothing until revisions exist, and a
 * pin that is not the component's is refused again here; both are `unresolved`. The two queries are
 * `numberingInputs`' shape without the content; that function could be built on this one, and is left
 * alone so a publishing plan does not move structure's tested function.
 */
export async function resolveOccurrences(
  trx: TenantTransaction,
  outline: OutlineDocument,
  principalId: string,
): Promise<OccurrenceOutcome[]> {
  const references: {
    node: string;
    component: string;
    pinned: string | null;
    approved: boolean;
  }[] = [];
  walkOutline(outline.nodes, (node) => {
    if (node.type !== 'reference') return;
    references.push({
      node: node.id,
      component: node.component,
      pinned: node.mode.kind === 'pinned' ? node.mode.version : null,
      approved: node.mode.kind === 'approved',
    });
  });
  const readable = await readableComponents(
    trx,
    principalId,
    references.map((each) => each.component),
  );
  const latest = [
    ...new Set(
      references
        .filter((each) => readable.has(each.component) && each.pinned === null && !each.approved)
        .map((each) => each.component),
    ),
  ];
  const pinned = [
    ...new Set(
      references.flatMap((each) =>
        readable.has(each.component) && each.pinned !== null ? [each.pinned] : [],
      ),
    ),
  ];
  const heads =
    latest.length === 0
      ? []
      : await trx
          .selectFrom('artifact as a')
          .where('a.id', 'in', latest)
          .innerJoinLateral(
            (eb) =>
              eb
                .selectFrom('artifact_version as v')
                .select(['v.id', 'v.artifact_id'])
                .whereRef('v.artifact_id', '=', 'a.id')
                .orderBy('v.revision_no', 'desc')
                .orderBy('v.version_no', 'desc')
                .limit(1)
                .as('head'),
            (join) => join.onTrue(),
          )
          .select(['head.id', 'head.artifact_id'])
          .execute();
  // Restricted to the readable set in the query itself, as numberingInputs' pins are (F7): a pin to a
  // version of a component the principal may not read is never selected, whichever reference names it.
  const pins =
    pinned.length === 0
      ? []
      : await trx
          .selectFrom('artifact_version')
          .select(['id', 'artifact_id'])
          .where('id', 'in', pinned)
          .where('artifact_id', 'in', [...readable])
          .execute();
  const headOf = new Map(heads.map((row) => [row.artifact_id, row.id]));
  const pinOf = new Map(pins.map((row) => [row.id, row.artifact_id]));

  return references.map((reference): OccurrenceOutcome => {
    const { node, component } = reference;
    if (!readable.has(component)) return { node, outcome: 'unreadable' };
    if (reference.approved) return { node, outcome: 'unresolved' };
    if (reference.pinned !== null) {
      return pinOf.get(reference.pinned) === component
        ? { node, outcome: 'resolved', component, version: reference.pinned }
        : { node, outcome: 'unresolved' };
    }
    const head = headOf.get(component);
    return head === undefined
      ? { node, outcome: 'unresolved' }
      : { node, outcome: 'resolved', component, version: head };
  });
}

/**
 * Each image in these blocks at any depth, with the asset version it places and the block a refusal
 * names: a figure's own, and for an image in a run of text (figures 5) the block holding the run - a
 * paragraph's own, and for a term, an attribution or a caption the list's, the quotation's, the table's
 * or the figure's, as publishing names a failure in one.
 */
function imagesIn(
  blocks: readonly BlockNode[],
): { readonly block: string; readonly asset: string }[] {
  const inRuns = (content: readonly InlineNode[] | undefined, block: string) =>
    (content ?? []).flatMap((inline) =>
      inline.type === 'image' ? [{ block, asset: inline.asset }] : [],
    );
  return blocks.flatMap((block) => {
    switch (block.type) {
      case 'paragraph':
        return inRuns(block.content, block.id);
      case 'figure':
        // A bound figure's image is the binding's, held by the dataset version the request records
        // (the B6 plan, B6-F), never an asset version of the request's own.
        return [
          ...(block.asset === undefined ? [] : [{ block: block.id, asset: block.asset }]),
          ...inRuns(block.caption, block.id),
        ];
      case 'list':
        return block.items.flatMap((item) => [
          ...inRuns(item.term, block.id),
          ...imagesIn(item.content),
        ]);
      case 'blockquote':
        return [...imagesIn(block.content), ...inRuns(block.attribution, block.id)];
      case 'table':
        return [
          ...inRuns(block.caption, block.id),
          ...block.rows.flatMap((row) => row.cells.flatMap((cell) => imagesIn(cell.content))),
        ];
      default:
        return [];
    }
  });
}

/** Whether inline content cites a page (PUB-074): a `page` reference, or one in a footnote in it. */
function pageCitedIn(content: readonly InlineNode[] | undefined): boolean {
  return (content ?? []).some(
    (inline) =>
      (inline.type === 'crossReference' && inline.display === 'page') ||
      // A footnote's paragraphs, which the content model holds as its own (CNT-129).
      (inline.type === 'footnote' && citesAPage(inline.content as readonly BlockNode[])),
  );
}

/**
 * Whether these blocks cite a page anywhere they hold inline content, at any depth (PUB-074): a
 * paragraph's text, a term, an attribution, a caption, a table's note and every cell, and a bound
 * table's caption, empty statement, note and source. Preformatted
 * text and a block equation hold none. A `page` reference counts whether or not it declares a form for
 * an output with no pages (STR-055): Word has pages, only not the PDF's, so what it would print there
 * is a page number that cites the wrong document.
 */
function citesAPage(blocks: readonly BlockNode[]): boolean {
  return blocks.some((block) => {
    switch (block.type) {
      case 'paragraph':
        return pageCitedIn(block.content);
      case 'list':
        return block.items.some((item) => pageCitedIn(item.term) || citesAPage(item.content));
      case 'blockquote':
        return citesAPage(block.content) || pageCitedIn(block.attribution);
      case 'table':
        return (
          pageCitedIn(block.caption) ||
          pageCitedIn(block.note) ||
          block.rows.some((row) => row.cells.some((cell) => citesAPage(cell.content)))
        );
      case 'boundTable':
        // Its inline content, walked as a table's (the TB1 plan, TB1-D); its cells are values.
        return (
          pageCitedIn(block.caption) ||
          pageCitedIn(block.empty) ||
          pageCitedIn(block.note) ||
          pageCitedIn(block.source)
        );
      case 'figure':
        return pageCitedIn(block.caption);
      default:
        return false;
    }
  });
}

/** A resolved occurrence with its version's content, read as its publisher resolved it. */
interface ReadOccurrence {
  readonly node: string;
  readonly component: string;
  readonly version: string;
  readonly content: ContentDocument;
}

/**
 * The content of every version the resolved occurrences take, read once for everything the request
 * decides from it: the images they place, and whether they cite a page. Only a version the publisher
 * resolved - one it may read - is ever selected.
 */
async function readResolved(
  trx: TenantTransaction,
  resolved: readonly {
    readonly node: string;
    readonly component: string;
    readonly version: string;
  }[],
): Promise<readonly ReadOccurrence[]> {
  if (resolved.length === 0) return [];
  const rows = await trx
    .selectFrom('artifact_version')
    .select(['id', 'artifact_id', 'content'])
    .where(
      'id',
      'in',
      resolved.map((each) => each.version),
    )
    .execute();
  const contentOf = new Map(rows.map((row) => [row.id, row]));
  return resolved.map(({ node, component, version }) => {
    const row = contentOf.get(version)!;
    const read = readContent(row.content, { artifact: row.artifact_id, version });
    if (!read.ok) throw new Error(`The component ${row.artifact_id} at ${version} does not read`);
    return { node, component, version, content: read.document };
  });
}

/**
 * MET-023 (definitions.md, "Held at publication"): each resolved component version validated against
 * the definition versions **it recorded** (MET-017), never the current ones, each failure the
 * request's own against its node - the field's name and what is wrong, never a value. Only versions
 * the publisher may read reach here, so nothing of one they may not is read. Definitions are read once
 * each, however many versions record them.
 */
async function componentFailures(
  trx: TenantTransaction,
  resolved: readonly { readonly node: string; readonly version: string }[],
): Promise<PublishFailure[]> {
  const definitions = new Map<string, unknown>();
  const definitionAt = async <K extends 'field' | 'metadataSchema' | 'componentType'>(
    kind: K,
    version: string,
  ): Promise<DefinitionOf[K]> => {
    const known = definitions.get(version);
    if (known !== undefined) return known as DefinitionOf[K];
    const stored = await readVersion(trx, version);
    if (!stored) throw new Error(`The ${kind} version ${version} a component records is gone`);
    const read = readDefinition(kind, stored.content, {
      artifact: stored.artifactId,
      version,
    });
    if (!read.ok) throw new Error(`The ${kind} at ${version} does not read: ${read.failure}`);
    definitions.set(version, read.definition);
    return read.definition;
  };
  const failures: PublishFailure[] = [];
  for (const { node, version } of resolved) {
    const stored = await readVersion(trx, version);
    if (!stored) throw new Error(`The component version ${version} resolved is gone`);
    const recorded = stored.definitions;
    const typeRef = recorded.find((each) => each.kind === 'componentType');
    if (!typeRef) throw new Error(`The component version ${version} records no component type`);
    const type = await definitionAt('componentType', typeRef.version);
    const schemas = [];
    const fields = [];
    for (const each of recorded) {
      if (each.kind === 'metadataSchema')
        schemas.push(await definitionAt('metadataSchema', each.version));
      if (each.kind === 'field') fields.push(await definitionAt('field', each.version));
    }
    const effective = resolveComponentFields(type, schemas, fields);
    const names = new Map(effective.map((each) => [each.field.id, each.field.name]));
    for (const each of validate(effective, stored.values)) {
      failures.push({
        stage: 'resolve',
        code: 'component_metadata_invalid',
        node,
        block: null,
        detail: `${names.get(each.field) ?? each.field}: ${each.detail}`,
      });
    }
  }
  return failures;
}

/**
 * Every image the resolved occurrences place, decided as the publisher (figures 3, ruling R6;
 * assets.md, "The publisher's half"): the asset versions to record on the request, each once, and a
 * failure naming the node and the figure for each figure whose image the publisher may not read or
 * that names no asset version - the two told apart no more than an occurrence's are, and the image
 * never named (issue #143). An image is read on its asset by the one readable-set predicate every
 * listing of content uses, so a component and an image are decided alike.
 */
async function resolveImages(
  trx: TenantTransaction,
  resolved: readonly ReadOccurrence[],
  principalId: string,
): Promise<{
  readonly assets: readonly { readonly version: string; readonly asset: string }[];
  readonly failures: readonly PublishFailure[];
}> {
  const placed = resolved.flatMap(({ node, content }) =>
    imagesIn(content.content).map((figure) => ({ node, ...figure })),
  );
  if (placed.length === 0) return { assets: [], failures: [] };

  const readable = await loadReadableSet(trx, principalId);
  const wanted = [...new Set(placed.map((each) => each.asset))];
  const images = readable
    ? await trx
        .selectFrom('artifact_version as v')
        .innerJoin('artifact as a', 'a.id', 'v.artifact_id')
        .select(['v.id', 'v.artifact_id'])
        .where('v.kind', '=', 'asset')
        .where('v.id', 'in', wanted)
        .where((eb) => readableArtifacts(eb, readable))
        .execute()
    : [];
  const assetOf = new Map(images.map((row) => [row.id, row.artifact_id]));
  // Named once per block, however many images in it the publisher may not read: a paragraph with two
  // is one place to look, and the author is not told it twice (figures 5).
  const named = new Set<string>();
  const failures: PublishFailure[] = [];
  for (const each of placed) {
    const place = `${each.node} ${each.block}`;
    if (assetOf.has(each.asset) || named.has(place)) continue;
    named.add(place);
    failures.push({
      stage: 'resolve',
      code: 'asset_unreadable',
      node: each.node,
      block: each.block,
      detail: null,
    });
  }
  const assets = [...assetOf].map(([version, asset]) => ({ version, asset }));
  return { assets, failures };
}

export type PublicationRequestAnswer =
  | {
      readonly answer: 'requested';
      readonly request: { readonly id: string; readonly state: 'queued' };
    }
  /**
   * The document is not at the version the caller named: they would publish what they have not seen.
   * The current version by its heading alone, so the caller is told which version it is at (API-037)
   * - its outline names components and pinned versions the caller may not read, so that is never
   * handed back from here (IAM-073).
   */
  | { readonly answer: 'version.precondition'; readonly current: VersionHeading }
  /**
   * A format the layout the request would be made under does not make (PUB-014), each named once,
   * refused rather than approximated. No format, or one named twice, is refused naming none.
   */
  | { readonly answer: 'format.unsupported'; readonly formats: readonly string[] }
  /**
   * The document's language is not one the layout's words are written in (PUB-095): the layout's tag,
   * taken as a language range, does not match the document's. Both tags, and nothing of any component.
   */
  | { readonly answer: 'layout.language'; readonly document: string; readonly layout: string }
  /**
   * A request without the PDF whose document cites a page, in a section's title or in a component
   * the publisher may read (PUB-074): the PDF is the output a page number cites (PUB-065), and Word's
   * pages are not its. Nothing of where: the author asked for it, and adding the PDF answers it.
   */
  | { readonly answer: 'page_reference.without_pdf' }
  /**
   * A section the document's template requires that no section of this version came from (TPL-013),
   * each by its starting title, in the template's order.
   */
  | { readonly answer: 'section.required'; readonly sections: readonly MissingSection[] }
  /**
   * The document's values, or a section's, do not satisfy its template's fields (TPL-055): every
   * failure, each with the node it belongs to, `null` for the document's own.
   */
  | { readonly answer: 'metadata.invalid'; readonly failures: readonly NodeFailure[] }
  /** Its template no longer resolves, so there is nothing to check its values against (TE-K). */
  | { readonly answer: 'template.unresolved'; readonly unresolved: readonly UnresolvedReference[] }
  /**
   * A binding the resolved components hold with no result in this document (B3-C; DAT-087): `never`
   * resolved, or its latest resolution `changed` - taken under another digest, the binding edited
   * since. Each by its node, in reading order, and nothing is recorded.
   */
  | { readonly answer: 'binding.unresolved'; readonly bindings: readonly UnresolvedBinding[] }
  | { readonly answer: 'document.missing' };

/** A binding a request cannot publish, and why (B3-C). */
export interface UnresolvedBinding {
  readonly node: string;
  readonly binding: string;
  readonly reason: 'never' | 'changed';
}

/** A binding's latest resolution, recorded on a request when its digest matches (B3-C). */
interface HeldBinding {
  readonly node: string;
  readonly binding: string;
  readonly digest: string;
  readonly resolution: string;
  readonly datasetVersion: string;
  readonly datasetId: string;
}

/**
 * Each binding the resolved occurrences hold, against the latest resolution its document has for its
 * node and binding: held where that resolution's digest is the binding's as read now, and otherwise
 * unresolved, `never` or `changed`.
 */
async function bindingsHeld(
  trx: TenantTransaction,
  documentId: string,
  resolved: readonly ReadOccurrence[],
): Promise<{ held: HeldBinding[]; unresolved: UnresolvedBinding[] }> {
  const asked = resolved.flatMap((each) =>
    bindingsIn(each.content).map(({ binding }) => ({
      node: each.node,
      binding: binding.id,
      digest: sha256Hex(bindingDigestInput(binding)),
    })),
  );
  if (asked.length === 0) return { held: [], unresolved: [] };
  const latest = await trx
    .selectFrom('binding_resolution')
    .distinctOn(['node_id', 'binding_id'])
    .select(['id', 'node_id', 'binding_id', 'binding_digest', 'dataset_version', 'dataset_id'])
    .where('document_id', '=', documentId)
    .orderBy('node_id')
    .orderBy('binding_id')
    .orderBy('id', 'desc')
    .execute();
  const byKey = new Map(latest.map((row) => [`${row.node_id} ${row.binding_id}`, row]));
  const held: HeldBinding[] = [];
  const unresolved: UnresolvedBinding[] = [];
  for (const each of asked) {
    const row = byKey.get(`${each.node} ${each.binding}`);
    if (row === undefined)
      unresolved.push({ node: each.node, binding: each.binding, reason: 'never' });
    else if (row.binding_digest !== each.digest) {
      unresolved.push({ node: each.node, binding: each.binding, reason: 'changed' });
    } else {
      held.push({
        ...each,
        resolution: String(row.id),
        datasetVersion: row.dataset_version,
        datasetId: row.dataset_id,
      });
    }
  }
  return { held, unresolved };
}

/**
 * One publish asked for, decided and recorded in the caller's transaction (docs/design/publishing.md,
 * "Who may publish"): `publish` has been decided on the document before this runs, under the access
 * epoch's shared lock. It is made under the document's layout (`documentLayout`), and refuses a stale
 * version, a format that layout does not make or a document in another language than its words before
 * recording anything; otherwise it resolves every occurrence **as the publisher**, refuses a request
 * without the PDF whose document cites a page (PUB-074), and records the request with the failures
 * resolving found - each naming its node and nothing else (issue #143) - one row per resolved
 * occurrence, and the job, all in one transaction. A request with failures is still queued: `assemble` adds its own for
 * what the publisher can read, and the author is told once (PUB-052). The formats are recorded PDF
 * first, whichever order they were asked in: a set, spelled one way.
 *
 * **A preview is asked for here too, by the same code path** (publishing.md, "Preview"; PUB-006):
 * every check and refusal above is a publish's, and it records the same versions, layout and theme a
 * publish of that version would. It differs in three things: it is the PDF alone (PV-C), so a format
 * beyond it is refused by name; it is recorded as a preview; and its job is a `preview`. Who may ask
 * for one - `read` on the document, where a publish needs `publish` - is the caller's to decide, as
 * `publish` is (PV-B).
 */
export async function requestPublication(
  trx: TenantTransaction,
  input: {
    readonly documentId: string;
    readonly version: string;
    readonly formats: readonly string[];
    readonly requester: string;
    /** A publish unless told: a preview of that version, marked as one and kept for an hour. */
    readonly kind?: 'publish' | 'preview';
  },
): Promise<PublicationRequestAnswer> {
  const kind = input.kind ?? 'publish';
  const latest = await latestVersion(trx, input.documentId);
  if (!latest || latest.kind !== 'document') return { answer: 'document.missing' };
  if (latest.id !== input.version) {
    return { answer: 'version.precondition', current: headingOf(latest) };
  }

  // Made under the document's layout at its latest version - its template's, or the environment's
  // declared one (templates.md) - recorded by its key: the job publishes under that version, whatever
  // the layout becomes before it runs.
  const layout = await documentLayout(trx, input.documentId);
  // Under a layout that makes no PDF a preview of one is refused here too, naming `pdf`.
  const unsupported = unsupportedFormats(layout.layout, input.formats);
  if (unsupported.length > 0) return { answer: 'format.unsupported', formats: unsupported };
  // A preview is the PDF alone (PV-C): Word's pagination would be our guess at Word's, which is why
  // CNT-095 was narrowed. Each format beyond it is named once, in the order asked.
  if (kind === 'preview') {
    const beyond = [...new Set(input.formats.filter((format) => format !== 'pdf'))];
    if (beyond.length > 0) return { answer: 'format.unsupported', formats: beyond };
  }
  // The contract refuses both; this function is public, and would otherwise record a request for
  // formats nobody named, or one format twice.
  if (input.formats.length === 0 || new Set(input.formats).size !== input.formats.length) {
    return { answer: 'format.unsupported', formats: [] };
  }
  const read = readOutline(latest.content, { artifact: input.documentId, version: latest.id });
  if (!read.ok) throw new Error(`The document ${input.documentId} at ${latest.id} does not read`);
  if (!speaksFor(layout.layout.language, read.outline.language)) {
    return {
      answer: 'layout.language',
      document: read.outline.language,
      layout: layout.layout.language,
    };
  }

  const outcomes = await resolveOccurrences(trx, read.outline, input.requester);
  const failures: PublishFailure[] = outcomes.flatMap((each) =>
    each.outcome === 'resolved'
      ? []
      : [
          {
            stage: 'resolve' as const,
            code:
              each.outcome === 'unreadable'
                ? ('occurrence_unreadable' as const)
                : ('occurrence_unresolved' as const),
            node: each.node,
            block: null,
            detail: null,
          },
        ],
  );
  const resolved = await readResolved(
    trx,
    outcomes.flatMap((each) => (each.outcome === 'resolved' ? [each] : [])),
  );
  // Decided from what the publisher may read, as everything here is: a component they may not read is
  // never read for a page, and fails the request as an unreadable occurrence instead.
  if (!input.formats.includes('pdf')) {
    let titled = false;
    walkOutline(read.outline.nodes, (node) => {
      if (node.type === 'section' && pageCitedIn(node.title)) titled = true;
    });
    if (titled || resolved.some((each) => citesAPage(each.content.content))) {
      return { answer: 'page_reference.without_pdf' };
    }
  }
  // A document made from a template is held to it at the door, after every check above and before
  // anything is queued, sections first (templates.md, TE-H): its required sections, by the recorded
  // version, and its values and its sections', against the fields resolved now (TE-K).
  const rules = await documentRules(trx, input.documentId);
  if (rules.bound) {
    const sections = missingSections(rules.definition, read.outline);
    if (sections.length > 0) return { answer: 'section.required', sections };
    if (!rules.resolved.ok) {
      return { answer: 'template.unresolved', unresolved: rules.resolved.unresolved };
    }
    const failures = valueFailures(rules.resolved, read.outline, latest.values);
    if (failures.length > 0) return { answer: 'metadata.invalid', failures };
  }
  // Every binding the publisher's resolved components hold, by its latest resolution in this document
  // (B3-C): one without a result, or with one taken under another digest, refuses the request by name.
  const bindings = await bindingsHeld(trx, input.documentId, resolved);
  if (bindings.unresolved.length > 0) {
    return { answer: 'binding.unresolved', bindings: bindings.unresolved };
  }
  const images = await resolveImages(trx, resolved, input.requester);
  const held = await componentFailures(trx, resolved);
  // Set from the document's theme - its template's (STY-025), or the environment's declared one - at
  // its latest version, recorded by its key beside the layout's (themes 1, ruling R5): the version
  // names its catalogues' versions, so the job sets the publication from exactly what was chosen now,
  // whatever the theme becomes before it runs. Read whole, so a theme that does not read is a broken
  // store here rather than in the job.
  const theme = await documentTheme(trx, input.documentId);
  const request = await trx
    .insertInto('publication_request')
    .values({
      document_id: input.documentId,
      document_version_id: latest.id,
      // Every one named is one the layout makes, which is one of these, checked above.
      formats: PUBLISHING_FORMATS.filter((format) => input.formats.includes(format)),
      requested_by: input.requester,
      failures: JSON.stringify([...failures, ...held, ...images.failures]),
      layout_id: layout.artifactId,
      layout_version_id: layout.versionId,
      theme_id: theme.artifactId,
      theme_version_id: theme.versionId,
      // A preview names its kind; a publish is the column's default, as every request before 0035 was.
      ...(kind === 'preview' ? { kind } : {}),
    })
    .returning(['id'])
    .executeTakeFirstOrThrow();
  if (resolved.length > 0) {
    await trx
      .insertInto('publication_request_occurrence')
      .values(
        resolved.map((each) => ({
          request_id: request.id,
          node: each.node,
          component_id: each.component,
          version_id: each.version,
        })),
      )
      .execute();
  }
  if (images.assets.length > 0) {
    await trx
      .insertInto('publication_request_asset')
      .values(
        images.assets.map((each) => ({
          request_id: request.id,
          version_id: each.version,
          asset_id: each.asset,
        })),
      )
      .execute();
  }
  if (bindings.held.length > 0) {
    await trx
      .insertInto('publication_request_binding')
      .values(
        bindings.held.map((each) => ({
          request_id: request.id,
          node: each.node,
          binding: each.binding,
          digest: each.digest,
          resolution: each.resolution,
          dataset_version: each.datasetVersion,
          dataset_id: each.datasetId,
        })),
      )
      .execute();
  }
  // A job kind of its own, on the one queue, so a deployment can give previews workers of their own.
  await enqueueJob(trx, kind, request.id);
  return { answer: 'requested', request: { id: request.id, state: 'queued' } };
}

/** What the worker assembles from: everything recorded at the request, read as the tenant. */
export interface PublicationInputs {
  readonly request: {
    readonly id: string;
    /** What the job makes of it (0035): a publication, or a preview, which records none. */
    readonly kind: 'publish' | 'preview';
    readonly documentId: string;
    readonly documentVersionId: string;
    readonly requestedBy: string;
    readonly requestedAt: Date;
    readonly spaceId: string;
    /**
     * The formats it asked for, PDF first, as recorded (Word 1, ruling R12): the job makes one output
     * of each, and a publication records exactly these. Never empty: 0027's check holds it to one of
     * three sets.
     */
    readonly formats: readonly [PublishingFormat, ...PublishingFormat[]];
  };
  readonly outline: OutlineDocument;
  readonly occurrences: ReadonlyMap<
    string,
    { readonly version: string; readonly content: ContentDocument }
  >;
  readonly refused: readonly PublishFailure[];
  /**
   * The layout version the request was made under, as recorded on it - never the layout's latest - or
   * null for a request made before layouts existed (0018), which publishes as the first slice did.
   */
  readonly layout: { readonly versionId: string; readonly layout: Layout } | null;
  /**
   * The theme version the request was made under, as recorded on it - never the theme's latest - read
   * with the catalogue versions it names; or null for a request made before layouts, which template 1
   * sets and which reads no theme, as its layout is null (0024 gave a theme only to a request still
   * queued under a layout, and every request made since names one).
   */
  readonly theme: { readonly versionId: string; readonly theme: ResolvedTheme } | null;
  /** The document's version as `revision.version` (VER-009): what a running foot's `revision` shows. */
  readonly revision: string;
  /**
   * Every image the request recorded, by asset version: where its bytes are and what `assemble` sizes
   * and describes it from. One the publisher could not read is not here; the request says why.
   */
  readonly assets: ReadonlyMap<string, PublishingAsset>;
  /**
   * Each binding the request recorded (B3-C), by node and then binding: the resolution, the dataset
   * version whose result the worker reads by its checksum, and that version's dataset and provenance.
   */
  readonly bindings: ReadonlyMap<string, ReadonlyMap<string, RecordedBinding>>;
  /**
   * Every asset version the recorded dataset versions' provenance `images` name, by asset version (the
   * B6 plan, B6-F): what a bound image is sized and placed from. Nothing on the request records them,
   * since the dataset version does; the worker reads the bytes only of those the binding stage placed.
   */
  readonly boundAssets: ReadonlyMap<string, PublishingAsset>;
}

/** A binding as a request or a publication records it, with the dataset version it took. */
export interface RecordedBinding {
  readonly resolution: string;
  readonly datasetVersion: string;
  readonly dataset: HeldDataset;
  /** The key of the definition version that dataset version ran (TB3-B); empty where it declares none. */
  readonly key: readonly string[];
}

/**
 * Whether a request's resolved components hold a binding, read from their content: exactly where the
 * request recorded its bindings, since one it could not resolve refused it (B3-C).
 */
async function holdsBindings(trx: TenantTransaction, requestId: string): Promise<boolean> {
  const { rows } = await sql<{ held: boolean }>`
    select exists (
      select 1 from publication_request_occurrence o
        join artifact_version v on v.id = o.version_id
       where o.request_id = ${requestId}
         and jsonb_path_exists(v.content, '$.** ? (@.type == "binding")')
    ) as held`.execute(trx);
  return rows[0]!.held;
}

/** The bindings recorded on a request or a publication, each with its dataset version, in order. */
async function recordedBindings(
  trx: TenantTransaction,
  on: { readonly request: string } | { readonly publication: string },
): Promise<(RecordedBinding & { readonly node: string; readonly binding: string })[]> {
  const { rows } = await sql<{
    node: string;
    binding: string;
    resolution: string;
    dataset_version: string;
    dataset_id: string;
    revision_no: number;
    version_no: number;
    content: unknown;
    name: string | null;
    key: string[] | null;
  }>`
    select b.node, b.binding, b.resolution::text as resolution, b.dataset_version, b.dataset_id,
           v.revision_no, v.version_no, v.content,
           (select n.name from dataset_name n where n.dataset_id = b.dataset_id
             order by n.id desc limit 1) as name,
           d.content->'key' as key
      from ${'request' in on ? sql`publication_request_binding` : sql`publication_binding`} b
      join artifact_version v on v.id = b.dataset_version
      left join artifact_version d
        on d.id = (v.content->'queryDefinition'->>'version')::uuid and d.kind = 'queryDefinition'
     where ${'request' in on ? sql`b.request_id = ${on.request}` : sql`b.publication_id = ${on.publication}`}
     order by b.node collate "C", b.binding collate "C"`.execute(trx);
  return rows.map((row) => ({
    node: row.node,
    binding: row.binding,
    resolution: row.resolution,
    datasetVersion: row.dataset_version,
    dataset: {
      id: row.dataset_id,
      name: row.name,
      number: `${row.revision_no}.${row.version_no}`,
      // Written by `recordDatasetVersion`, which parsed it: one that does not parse is a broken store.
      provenance: parseProvenance(row.content),
    },
    key: row.key ?? [],
  }));
}

/**
 * What a publication printed each value from (B3-C; DAT-042): its bindings, each with its dataset
 * version and provenance whole - the SQL, the connection and each column's source among it. Who may
 * read which of it is the caller's to decide.
 */
export async function publicationBindings(
  trx: TenantTransaction,
  publicationId: string,
): Promise<(RecordedBinding & { readonly node: string; readonly binding: string })[]> {
  if (!UUID.test(publicationId)) return [];
  return recordedBindings(trx, { publication: publicationId });
}

/** A binding as a document's latest publication printed it: what changed since is compared by these. */
export interface PublishedBinding {
  readonly node: string;
  readonly binding: string;
  /** The binding's digest, as the resolution the publication printed recorded it. */
  readonly digest: string;
  readonly datasetVersion: string;
  /** The definition version that dataset version ran, from its provenance. */
  readonly definitionVersion: string;
}

/**
 * The bindings a document's latest publication printed (B4-D), by `node binding`, or undefined where
 * it has never been published. A preview is no publication, so it is never the latest.
 */
export async function publishedBindings(
  trx: TenantTransaction,
  documentId: string,
): Promise<Map<string, PublishedBinding> | undefined> {
  if (!UUID.test(documentId)) return undefined;
  const latest = await sql<{ id: string }>`
    select p.id from publication p join artifact a on a.id = p.id
     where p.document_id = ${documentId}
     order by p.published_at desc, a.created_at desc
     limit 1`.execute(trx);
  const publication = latest.rows[0]?.id;
  if (publication === undefined) return undefined;
  const { rows } = await sql<{
    node: string;
    binding: string;
    digest: string;
    dataset_version: string;
    definition_version: string;
  }>`
    select b.node, b.binding, r.binding_digest as digest, b.dataset_version,
           v.content->'queryDefinition'->>'version' as definition_version
      from publication_binding b
      join binding_resolution r on r.id = b.resolution
      join artifact_version v on v.id = b.dataset_version
     where b.publication_id = ${publication}`.execute(trx);
  return new Map(
    rows.map((row) => [
      `${row.node} ${row.binding}`,
      {
        node: row.node,
        binding: row.binding,
        digest: row.digest,
        datasetVersion: row.dataset_version,
        definitionVersion: row.definition_version,
      },
    ]),
  );
}

/**
 * A queued request's inputs, or undefined when there is nothing to do - finished by another attempt.
 * The worker has no principal and decides nothing: it reads exactly the versions the request recorded
 * as its publisher resolved them, and no other.
 */
export async function publicationInputs(
  trx: TenantTransaction,
  requestId: string,
): Promise<PublicationInputs | undefined> {
  const request = await trx
    .selectFrom('publication_request as r')
    .innerJoin('artifact as a', 'a.id', 'r.document_id')
    .innerJoin('artifact_version as v', 'v.id', 'r.document_version_id')
    .leftJoin('artifact_version as l', 'l.id', 'r.layout_version_id')
    .select([
      'r.id',
      'r.kind',
      'r.document_id',
      'r.document_version_id',
      'r.requested_by',
      'r.requested_at',
      'r.state',
      'r.formats',
      'r.failures',
      'r.layout_id',
      'r.layout_version_id',
      'r.theme_version_id',
      'a.space_id',
      'v.content',
      'v.revision_no',
      'v.version_no',
      'l.content as layout_content',
    ])
    .where('r.id', '=', requestId)
    .executeTakeFirst();
  if (!request || request.state !== 'queued') return undefined;
  const read = readOutline(request.content, {
    artifact: request.document_id,
    version: request.document_version_id,
  });
  if (!read.ok) {
    throw new Error(
      `The document ${request.document_id} at ${request.document_version_id} does not read`,
    );
  }
  let layout: PublicationInputs['layout'] = null;
  if (request.layout_version_id !== null) {
    const stored = readLayout(request.layout_content, {
      artifact: request.layout_id!,
      version: request.layout_version_id,
    });
    // As a component that does not read: a broken store, thrown and so retried, then the engine's.
    if (!stored.ok) {
      throw new Error(`The layout ${stored.artifact} at ${stored.version} does not read`);
    }
    layout = { versionId: request.layout_version_id, layout: stored.layout };
  }
  // A theme that does not read is a broken store: thrown, and so retried and then recorded as the
  // engine's stage, as a layout that does not read is.
  const theme =
    request.theme_version_id === null
      ? null
      : {
          versionId: request.theme_version_id,
          theme: await themeAt(trx, request.theme_version_id),
        };
  const rows = await trx
    .selectFrom('publication_request_occurrence as o')
    .innerJoin('artifact_version as v', 'v.id', 'o.version_id')
    .select(['o.node', 'o.version_id', 'o.component_id', 'v.content'])
    .where('o.request_id', '=', requestId)
    .execute();
  const occurrences = new Map<string, { version: string; content: ContentDocument }>();
  for (const row of rows) {
    const content = readContent(row.content, {
      artifact: row.component_id,
      version: row.version_id,
    });
    // A stored version that does not read is a broken store, not the author's to fix: thrown, and so
    // retried and then recorded as the engine's stage.
    if (!content.ok) {
      throw new Error(`The component ${row.component_id} at ${row.version_id} does not read`);
    }
    occurrences.set(row.node, { version: row.version_id, content: content.document });
  }
  const images = await trx
    .selectFrom('publication_request_asset as q')
    .innerJoin('artifact_version as v', 'v.id', 'q.version_id')
    .select(['q.version_id', 'v.content'])
    .where('q.request_id', '=', requestId)
    .execute();
  const assets = new Map<string, PublishingAsset>();
  for (const row of images) {
    // An asset version that does not parse is a broken store, as a component that does not read is.
    const { object, format, width, height, alternative } = parseAssetVersion(row.content);
    assets.set(row.version_id, { object, format, width, height, alternative });
  }
  // Read only where a component holds a binding: the request recorded one for each, or was refused.
  const bindings = new Map<string, Map<string, RecordedBinding>>();
  const holding = [...occurrences.values()].some((each) => bindingsIn(each.content).length > 0);
  for (const { node, binding, ...recorded } of holding
    ? await recordedBindings(trx, { request: requestId })
    : []) {
    if (!bindings.has(node)) bindings.set(node, new Map());
    bindings.get(node)!.set(binding, recorded);
  }
  // Every image the held results could place, in one query: a binding's take is the stage's to decide.
  const named = [
    ...new Set(
      [...bindings.values()].flatMap((each) =>
        [...each.values()].flatMap((recorded) => Object.values(recorded.dataset.provenance.images)),
      ),
    ),
  ];
  const boundAssets = new Map<string, PublishingAsset>();
  if (named.length > 0) {
    const rows = await trx
      .selectFrom('artifact_version')
      .select(['id', 'content'])
      .where('kind', '=', 'asset')
      .where('id', 'in', named)
      .execute();
    for (const row of rows) {
      const { object, format, width, height, alternative } = parseAssetVersion(row.content);
      boundAssets.set(row.id, { object, format, width, height, alternative });
    }
  }
  return {
    request: {
      id: request.id,
      kind: request.kind,
      documentId: request.document_id,
      documentVersionId: request.document_version_id,
      requestedBy: request.requested_by,
      requestedAt: request.requested_at,
      spaceId: request.space_id!,
      formats: request.formats as [PublishingFormat, ...PublishingFormat[]],
    },
    outline: read.outline,
    occurrences,
    // Written only by requestPublication, whose failures are `PublishFailure`s it built itself - each
    // of the resolve stage, naming a node, and for an image the figure, and nothing else - so they are
    // read back without a parse.
    refused: request.failures as PublishFailure[],
    layout,
    theme,
    revision: `${request.revision_no}.${request.version_no}`,
    assets,
    bindings,
    boundAssets,
  };
}

/** A request that ended without a publication: its failures, all at once, and nothing else. */
export async function failPublicationRequest(
  trx: TenantTransaction,
  requestId: string,
  failures: readonly PublishFailure[],
): Promise<void> {
  await trx
    .updateTable('publication_request')
    .set({ state: 'failed', failures: JSON.stringify(failures), finished_at: sql<Date>`now()` })
    .where('id', '=', requestId)
    .where('state', '=', 'queued')
    .execute();
}

/** One output of a publication, in the tenant's store by its hash, with what made it. */
export type NewPublicationOutput = {
  readonly key: string;
  readonly sha256: string;
  readonly bytes: number;
} & (
  | {
      /** A PDF, made by Typst at this version under this template: the publication's engine. */
      readonly format: 'pdf';
      readonly engineVersion: string;
      readonly templateVersion: number;
    }
  | {
      /** A Word document, made by the Word writer at this version (`word/1`), and its report. */
      readonly format: 'docx';
      readonly writerVersion: string;
      readonly report: OutputReport;
    }
  | {
      /** `provenance.json` (B3-G), made by the pipeline at its version: where a value is printed. */
      readonly format: 'provenance';
      readonly pipelineVersion: string;
    }
);

export interface NewPublication {
  readonly requestId: string;
  /** `assemble` and the job as one (PUB-063), which every output is made from. */
  readonly pipelineVersion: string;
  readonly fonts: readonly { readonly file: string; readonly sha256: string }[];
  readonly dataSha256: string;
  readonly numbering: NumberingTable;
  /** One per format the request names, each once (Word 1, ruling R11). */
  readonly outputs: readonly NewPublicationOutput[];
}

/**
 * The publication, inserted whole in one transaction once its outputs are stored (PUB-053): its
 * artifact in the document's space, its record, every version it read, and one output per format the
 * request names, each with its producer and its report (Word 1, ruling R11) - and the request marked
 * done. **The request's row is locked first**, so a second worker racing an expired
 * lease waits, then finds it done and inserts nothing. Answers the publication's id, or undefined where
 * the request had already finished.
 *
 * A request still carrying failures - an occurrence its publisher could not read or resolve - has no
 * publication to record: `assemble` refuses it, so reaching here with one is a bug in the caller. It
 * throws before inserting anything rather than leaving the refusal to 0017's
 * `publication_request_done_without_failures`, which would only catch it at the last statement. So
 * does a set of outputs that is not one per format the request names, or a Word report that is not
 * one, which 0027's checks would otherwise refuse only at a row or at commit.
 */
export async function recordPublication(
  trx: TenantTransaction,
  input: NewPublication,
): Promise<string | undefined> {
  const request = await trx
    .selectFrom('publication_request as r')
    .innerJoin('artifact as a', 'a.id', 'r.document_id')
    .select([
      'r.id',
      'r.kind',
      'r.state',
      'r.document_id',
      'r.document_version_id',
      'r.requested_by',
      'r.requested_at',
      'r.formats',
      'r.failures',
      'r.layout_id',
      'r.layout_version_id',
      'r.theme_id',
      'r.theme_version_id',
      'a.space_id',
    ])
    .where('r.id', '=', input.requestId)
    .forUpdate('r')
    .executeTakeFirst();
  // A preview makes no publication (PV-A): reaching here with one is a bug in the caller, refused
  // before anything is written, as 0035's `publication_recorded_whole` would refuse it at commit.
  if (request?.kind === 'preview') {
    throw new Error(
      `The request ${request.id} is a preview, which records no publication: record it with recordPreview`,
    );
  }
  if (!request || request.state !== 'queued') return undefined;
  if (request.failures.length > 0) {
    throw new Error(
      `The request ${request.id} carries failures, so it has no publication to record: fail it instead`,
    );
  }
  const made = input.outputs.flatMap((each) => (each.format === 'provenance' ? [] : [each.format]));
  if (
    made.length !== request.formats.length ||
    !request.formats.every((format) => made.includes(format))
  ) {
    throw new Error(
      `The request ${request.id} asked for ${request.formats.join(', ')}, and a publication records one output per format it asked for: ${made.join(', ') || 'none'} is not that`,
    );
  }
  // `provenance.json` exactly where the request holds a binding, and once (B3-G; DAT-042).
  const bound = await holdsBindings(trx, request.id);
  const provenances = input.outputs.filter((each) => each.format === 'provenance').length;
  if (provenances !== (bound ? 1 : 0)) {
    throw new Error(
      `The request ${request.id} ${bound ? 'holds a binding, and a publication of it records one provenance output' : 'holds no binding, so a publication of it records no provenance output'}`,
    );
  }
  // What the writer reports is held to its closed shape before it is stored, as it is read back.
  for (const each of input.outputs) if (each.format === 'docx') parseOutputReport(each.report);
  // All or nothing within the caller's transaction too: a failure part way - a refused row, or a lost
  // connection after a statement ran - rolls back to here before it is re-thrown, so a caller that
  // catches it and carries on (to fail the request) keeps no part of the publication. 0017's
  // `publication_recorded_whole` refuses at commit whatever a caller that skipped this left.
  await sql`savepoint record_publication`.execute(trx);
  try {
    const id = await insertPublication(trx, request, input, bound);
    // Found by its words from the moment it is recorded, as a version is (search.md; SCH-066).
    await indexPublication(trx, id);
    // Its PDF checked by veraPDF afterwards, by a job queued now, in this transaction (W14.1, W-B): a
    // worker that dies once the record commits leaves the check queued, never lost, and a record
    // rolled back takes its check with it.
    if (input.outputs.some((each) => each.format === 'pdf')) {
      await enqueueJob(trx, 'check_pdf', id);
    }
    await sql`release savepoint record_publication`.execute(trx);
    return id;
  } catch (error) {
    // The failure that brought it here is the one reported. Where rolling back fails as well - the
    // connection is gone - the transaction cannot commit, and the check at commit stands regardless.
    await sql`rollback to savepoint record_publication`.execute(trx).catch(() => undefined);
    throw error;
  }
}

async function insertPublication(
  trx: TenantTransaction,
  request: {
    readonly id: string;
    readonly document_id: string;
    readonly document_version_id: string;
    readonly requested_by: string;
    readonly requested_at: Date;
    readonly formats: PublishingFormat[];
    readonly layout_id: string | null;
    readonly layout_version_id: string | null;
    readonly theme_id: string | null;
    readonly theme_version_id: string | null;
    readonly space_id: string | null;
  },
  input: NewPublication,
  bound: boolean,
): Promise<string> {
  // The PDF's engine and template are the publication's, as they always were; none without a PDF.
  const pdf = input.outputs.find((each) => each.format === 'pdf');
  const artifact = await trx
    .insertInto('artifact')
    .values({ kind: 'publication', space_id: request.space_id })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('publication')
    .values({
      id: artifact.id,
      request_id: request.id,
      document_id: request.document_id,
      document_version_id: request.document_version_id,
      publisher: request.requested_by,
      published_at: request.requested_at,
      approval: 'none',
      formats: request.formats,
      engine: pdf ? 'typst' : null,
      engine_version: pdf?.engineVersion ?? null,
      template: pdf ? 'publication' : null,
      template_version: pdf?.templateVersion ?? null,
      pipeline_version: input.pipelineVersion,
      fonts: JSON.stringify(input.fonts),
      data_sha256: input.dataSha256,
      numbering: JSON.stringify(input.numbering),
      // The request's, read under its lock: none for a request made before layouts (0018).
      layout_id: request.layout_id,
      layout_version_id: request.layout_version_id,
      // And its theme's, as 0024's `publication_recorded_whole` holds at commit: none for a request
      // made before layouts, which template 1 sets from no theme.
      theme_id: request.theme_id,
      theme_version_id: request.theme_version_id,
    })
    .execute();
  const occurrences = await trx
    .selectFrom('publication_request_occurrence')
    .select(['node', 'version_id'])
    .where('request_id', '=', request.id)
    .execute();
  await trx
    .insertInto('publication_input')
    .values([
      { publication_id: artifact.id, version_id: request.document_version_id, node: null },
      ...occurrences.map((each) => ({
        publication_id: artifact.id,
        version_id: each.version_id,
        node: each.node,
      })),
    ])
    .execute();
  // Exactly the images the request recorded (figures 3, ruling R6), which 0022's check holds at commit.
  const images = await trx
    .selectFrom('publication_request_asset')
    .select(['version_id', 'asset_id'])
    .where('request_id', '=', request.id)
    .execute();
  if (images.length > 0) {
    await trx
      .insertInto('publication_asset')
      .values(
        images.map((each) => ({
          publication_id: artifact.id,
          version_id: each.version_id,
          asset_id: each.asset_id,
        })),
      )
      .execute();
  }
  await trx
    .insertInto('publication_output')
    .values(
      input.outputs.map((each) => ({
        publication_id: artifact.id,
        format: each.format,
        object_key: each.key,
        sha256: each.sha256,
        bytes: each.bytes,
        ...(each.format === 'pdf'
          ? {
              standard: 'ua-1' as const,
              // Typst, under the template the publication names: 0027 holds the two equal at commit.
              producer: 'typst' as const,
              producer_version: String(each.templateVersion),
              report: '[]',
            }
          : each.format === 'docx'
            ? {
                standard: null,
                producer: 'word' as const,
                producer_version: each.writerVersion,
                report: JSON.stringify(each.report),
              }
            : {
                standard: null,
                producer: 'pipeline' as const,
                producer_version: each.pipelineVersion,
                report: '[]',
              }),
      })),
    )
    .execute();
  // Exactly the bindings the request recorded (B3-C), which 0050's check holds at commit.
  if (bound) {
    await sql`insert into publication_binding
                (publication_id, node, binding, resolution, dataset_version, dataset_id)
              select ${artifact.id}, node, binding, resolution, dataset_version, dataset_id
                from publication_request_binding where request_id = ${request.id}`.execute(trx);
  }
  await trx
    .updateTable('publication_request')
    .set({ state: 'done', finished_at: sql<Date>`now()` })
    .where('id', '=', request.id)
    .execute();
  return artifact.id;
}

/** A preview's PDF as it is recorded on its request: in the tenant's store by its hash. */
export interface NewPreview {
  readonly requestId: string;
  readonly key: string;
  readonly sha256: string;
  readonly bytes: number;
}

/**
 * A preview made (publishing.md, "Preview"; PV-A, PV-F): its PDF recorded on its request, which is
 * finished done and expires an hour later. Nothing else is written - no artifact, no publication, no
 * inputs and no outputs - so nothing lists it, searches it or keeps it. **The request's row is locked
 * first**, as `recordPublication` locks it, so a second worker racing an expired lease waits, then
 * finds it done and records nothing. Answers when it expires, or undefined where the request had
 * already finished or does not exist.
 *
 * A publish request has a publication to record, not a preview, and a request carrying failures has
 * nothing to record: `assemble` refuses it. Reaching here with either is a bug in the caller, thrown
 * before anything is written, as 0035's checks would otherwise refuse only at the row.
 */
export async function recordPreview(
  trx: TenantTransaction,
  input: NewPreview,
): Promise<Date | undefined> {
  const request = await trx
    .selectFrom('publication_request')
    .select(['id', 'kind', 'state', 'failures'])
    .where('id', '=', input.requestId)
    .forUpdate()
    .executeTakeFirst();
  if (!request) return undefined;
  if (request.kind !== 'preview') {
    throw new Error(
      `The request ${request.id} is a publish, which records a publication and never a preview: record it with recordPublication`,
    );
  }
  if (request.state !== 'queued') return undefined;
  if (request.failures.length > 0) {
    throw new Error(
      `The request ${request.id} carries failures, so it has no preview to record: fail it instead`,
    );
  }
  const done = await trx
    .updateTable('publication_request')
    .set({
      state: 'done',
      finished_at: sql<Date>`now()`,
      // An hour after it finished, read by the one clock that finished it (PV-F).
      expires_at: sql<Date>`now() + interval '1 hour'`,
      preview_key: input.key,
      preview_sha256: input.sha256,
      preview_bytes: input.bytes,
    })
    .where('id', '=', request.id)
    .returning('expires_at')
    .executeTakeFirstOrThrow();
  return done.expires_at!;
}

/** A request as its requester is shown it. */
export interface StoredPublicationRequest {
  readonly id: string;
  readonly documentId: string;
  readonly requestedBy: string;
  /** A publish, or a preview (0035). */
  readonly kind: 'publish' | 'preview';
  readonly state: 'queued' | 'done' | 'failed';
  readonly failures: readonly PublishFailure[];
  readonly publication: string | null;
  /**
   * A done preview's PDF and when it expires; null for anything else - a publish always, and a preview
   * still queued or failed. Whether it has expired is the caller's to decide against its own clock.
   */
  readonly preview: {
    readonly key: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly expiresAt: Date;
  } | null;
}

/**
 * One request, with the publication it made, if any; undefined when this environment holds none of
 * that id. It decides nothing: who may be shown it is the caller's to decide, by `requestedBy`. Its
 * failures are written only by `requestPublication` and `failPublicationRequest`, each a
 * `PublishFailure` built in code - an unreadable place carrying its node alone - so they are read back
 * without a parse.
 */
export async function readPublicationRequest(
  trx: TenantTransaction,
  id: string,
): Promise<StoredPublicationRequest | undefined> {
  if (!UUID.test(id)) return undefined;
  const row = await trx
    .selectFrom('publication_request as r')
    .leftJoin('publication as p', 'p.request_id', 'r.id')
    .select([
      'r.id',
      'r.document_id',
      'r.requested_by',
      'r.kind',
      'r.state',
      'r.failures',
      'r.preview_key',
      'r.preview_sha256',
      'r.preview_bytes',
      'r.expires_at',
      'p.id as publication',
    ])
    .where('r.id', '=', id)
    .executeTakeFirst();
  return (
    row && {
      id: row.id,
      documentId: row.document_id,
      requestedBy: row.requested_by,
      kind: row.kind,
      state: row.state,
      failures: row.failures as PublishFailure[],
      publication: row.publication,
      // 0035 holds all four to a done preview and to nothing else; read only there regardless, so
      // nothing can make a publish request read as a preview.
      preview:
        row.kind === 'preview' &&
        row.state === 'done' &&
        row.preview_key !== null &&
        row.preview_sha256 !== null &&
        row.preview_bytes !== null &&
        row.expires_at !== null
          ? {
              key: row.preview_key,
              sha256: row.preview_sha256,
              bytes: row.preview_bytes,
              expiresAt: row.expires_at,
            }
          : null,
    }
  );
}

/**
 * The preview sweep (publishing.md, "Preview"; PV-F): deletes every preview request finished an hour
 * ago or more, done or failed, with the versions and images it recorded, and answers the keys of the
 * done ones' PDFs that nothing left names, for the caller to remove from the tenant's store once this
 * transaction has committed. Measured by the database's clock, which finished each request and which
 * `publication_request_swept_only` (0036) holds every delete to.
 *
 * **A key is a hash, so a key another row names is kept**: a publication's output, another preview's
 * PDF, a sample, an upload being checked or kept, or an asset's version. Only a preview could in fact
 * share a preview's bytes - a publication says it is not approved where a preview says it is a
 * preview, and the rest are not this document at all - but a key named anywhere is kept whoever names
 * it, because removing bytes something still stands on is the one mistake here that cannot be undone.
 *
 * **Why a new preview cannot land on a key this removes.** The time a request was made, to the second,
 * is compiled into its PDF, so two previews are the same bytes only when they are of one document
 * version asked for in one second. They need not finish together, though: one can be retried, or wait
 * behind other jobs, long after the other has finished and expired. Its worker keeps the bytes in the
 * store before it records them on its request, so between the two its request is still queued and
 * names nothing, and a sweep that removed the key then would leave it recording a PDF that is gone. So
 * **a preview is not swept while another of its document version and its second is still queued**:
 * it stays, still naming the key, until that one finishes - done, naming the key itself, or failed,
 * naming none. Nothing can join that second an hour after it passed, since a request's time is the
 * start of the transaction that inserts it. The removal after the commit is then safe: every request
 * that could make these bytes has finished, and none that finished done names them.
 */
export async function sweepPreviews(trx: TenantTransaction): Promise<string[]> {
  const gone = await trx
    .deleteFrom('publication_request as r')
    .where('r.kind', '=', 'preview')
    .where('r.finished_at', '<=', sql<Date>`now() - interval '1 hour'`)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom('publication_request as q')
            .select('q.id')
            .where('q.kind', '=', 'preview')
            .where('q.state', '=', 'queued')
            .whereRef('q.document_version_id', '=', 'r.document_version_id')
            .whereRef('q.requested_at', '=', 'r.requested_at'),
        ),
      ),
    )
    .returning('r.preview_key')
    .execute();
  const keys = [
    ...new Set(gone.flatMap((row) => (row.preview_key === null ? [] : [row.preview_key]))),
  ];
  if (keys.length === 0) return [];
  // Read after the delete, so the requests just swept name nothing here.
  const named = await sql<{ key: string }>`
    select object_key as key from publication_output where object_key = any(${keys}::text[])
    union select preview_key from publication_request where preview_key = any(${keys}::text[])
    union select object_key from sample where object_key = any(${keys}::text[])
    union select object_key from asset_upload
      where object_key = any(${keys}::text[]) and state in ('checking', 'ready')
    union select content ->> 'object' from artifact_version
      where kind = 'asset' and content ->> 'object' = any(${keys}::text[])
    union select report_key from publication_check where report_key = any(${keys}::text[])`.execute(
    trx,
  );
  const kept = new Set(named.rows.map((row) => row.key));
  return keys.filter((key) => !kept.has(key));
}

/** One rule a PDF failed, as veraPDF numbers it: the clause of ISO 14289-1, and its test within it. */
export interface FailedRule {
  readonly clause: string;
  readonly test: number;
  /** What the rule asks for, in veraPDF's words. */
  readonly description?: string;
}

/** The most rules a check records: PDF/UA-1's profile has fewer, so a longer list is no report (0040). */
export const MAX_FAILED_RULES = 200;

/** The longest description of a rule a check keeps; veraPDF's own are a sentence or two. */
const MAX_RULE_DESCRIPTION = 1000;

/** veraPDF's whole report, as it wrote it, kept in the tenant's store by its hash (PUB-091). */
export interface KeptReport {
  readonly key: string;
  readonly sha256: string;
  readonly bytes: number;
}

/** What veraPDF found of a publication's PDF, as the `check_pdf` job records it (0040, W-C). */
export interface NewPublicationCheck {
  readonly publicationId: string;
  /** veraPDF's own version, as its report names it. */
  readonly checkerVersion: string;
  readonly compliant: boolean;
  readonly failedRules: readonly FailedRule[];
  /** The report the summary above was read from, already in the store. */
  readonly report: KeptReport;
}

/** A PDF's check as a reader is shown it: veraPDF at its version, against PDF/UA-1, and when. */
export interface StoredPublicationCheck {
  readonly checker: 'verapdf';
  readonly checkerVersion: string;
  readonly profile: 'ua1';
  readonly compliant: boolean;
  readonly failedRules: readonly FailedRule[];
  /** veraPDF's whole report, where the store keeps it. */
  readonly report: KeptReport;
  readonly checkedAt: Date;
}

/**
 * The PDF a `check_pdf` job checks: its key and digest in the tenant's store, or `checked` where a
 * check is already recorded, which a second run of the job leaves as it is. Undefined where the
 * publication has no PDF, or there is no such publication.
 */
export async function publicationToCheck(
  trx: TenantTransaction,
  publicationId: string,
): Promise<{ readonly key: string; readonly sha256: string } | 'checked' | undefined> {
  if (!UUID.test(publicationId)) return undefined;
  const row = await trx
    .selectFrom('publication_output as o')
    .leftJoin('publication_check as c', (join) =>
      join.onRef('c.publication_id', '=', 'o.publication_id').onRef('c.format', '=', 'o.format'),
    )
    .select(['o.object_key', 'o.sha256', 'c.checked_at'])
    .where('o.publication_id', '=', publicationId)
    .where('o.format', '=', 'pdf')
    .executeTakeFirst();
  if (!row) return undefined;
  if (row.checked_at !== null) return 'checked';
  return { key: row.object_key, sha256: row.sha256 };
}

/** How long after its publication is recorded its check may take (ADR-0030), before a sweep asks again. */
export const CHECK_WITHIN_MS = 5 * 60_000;

/**
 * The most publications one sweep queues a check for, or leaves, in one tenant: the rest wait for the
 * next. The first sweep after 0040 finds every publication recorded before it unchecked, with no check
 * ever queued, and checks them a hundred at a time.
 */
export const RECHECK_LIMIT = 100;

/**
 * How many of a publication's checks may give up before the sweep leaves it for good (0041): the one
 * queued as it was recorded, and two the sweep queued again. Each gives up after the queue's three
 * attempts: nine in all, the last at least fifteen minutes after the publication was recorded, since
 * the sweep asks again only five minutes on, and sweeps ten minutes apart by default.
 */
export const CHECK_GIVE_UPS = 3;

/**
 * The publications whose PDF is still unchecked this long after they were recorded, whose check is
 * not among `waiting` - the subjects of the tenant's `check_pdf` jobs still to run, which the caller
 * reads from the queue first - and which the sweep has not left for good (0041). Its check gave up,
 * then, after its last attempt, or was never queued, as for a publication recorded before 0040: the
 * sweep queues another, or leaves it. Oldest first, and at most a hundred. Recorded is when its
 * request was finished, by the database's clock, or when it was published where the request has gone.
 */
export async function publicationsToCheckAgain(
  trx: TenantTransaction,
  options: { readonly now: Date; readonly waiting: readonly string[] },
): Promise<string[]> {
  const before = new Date(options.now.getTime() - CHECK_WITHIN_MS);
  const recorded = sql<Date>`coalesce(r.finished_at, p.published_at)`;
  const rows = await trx
    .selectFrom('publication as p')
    .innerJoin('publication_output as o', (join) =>
      join.onRef('o.publication_id', '=', 'p.id').on('o.format', '=', 'pdf'),
    )
    .leftJoin('publication_request as r', 'r.id', 'p.request_id')
    .leftJoin('publication_check as c', (join) =>
      join.onRef('c.publication_id', '=', 'o.publication_id').onRef('c.format', '=', 'o.format'),
    )
    .leftJoin('publication_check_given_up as g', (join) =>
      join.onRef('g.publication_id', '=', 'o.publication_id').onRef('g.format', '=', 'o.format'),
    )
    .select('p.id')
    .where('c.publication_id', 'is', null)
    .where('g.publication_id', 'is', null)
    .where(recorded, '<=', before)
    .where(sql<boolean>`p.id <> all(${[...options.waiting]}::uuid[])`)
    .orderBy(recorded)
    .orderBy('p.id')
    .limit(RECHECK_LIMIT)
    .execute();
  return rows.map((row) => row.id);
}

/**
 * Records that the sweep left a publication's PDF unchecked for good, its checks having given up
 * `giveUps` times, once: `recorded`, or `already` where another sweep did first, which is kept.
 */
export async function recordCheckGivenUp(
  trx: TenantTransaction,
  publicationId: string,
  giveUps: number,
): Promise<'recorded' | 'already'> {
  const inserted = await trx
    .insertInto('publication_check_given_up')
    .values({ publication_id: publicationId, format: 'pdf', give_ups: giveUps })
    .onConflict((conflict) => conflict.columns(['publication_id', 'format']).doNothing())
    .executeTakeFirst();
  return inserted.numInsertedOrUpdatedRows === 1n ? 'recorded' : 'already';
}

/**
 * Records what veraPDF found of a publication's PDF, once: `recorded`, or `already` where a check was
 * recorded before - by an earlier run of the same job, whose lease ran out - which is kept as it is.
 * The rules are held to the bound 0040 holds them to, and each description to a thousand characters.
 */
export async function recordPublicationCheck(
  trx: TenantTransaction,
  check: NewPublicationCheck,
): Promise<'recorded' | 'already'> {
  if (check.failedRules.length > MAX_FAILED_RULES) {
    throw new Error(
      `A check records at most ${MAX_FAILED_RULES} failed rules, and this one has ${check.failedRules.length}`,
    );
  }
  const failedRules = check.failedRules.map(({ clause, test, description }) => ({
    clause,
    test,
    ...(description === undefined
      ? {}
      : { description: description.slice(0, MAX_RULE_DESCRIPTION) }),
  }));
  const inserted = await trx
    .insertInto('publication_check')
    .values({
      publication_id: check.publicationId,
      format: 'pdf',
      checker: 'verapdf',
      checker_version: check.checkerVersion,
      profile: 'ua1',
      compliant: check.compliant,
      failed_rules: JSON.stringify(failedRules),
      report_key: check.report.key,
      report_sha256: check.report.sha256,
      report_bytes: check.report.bytes,
    })
    .onConflict((conflict) => conflict.columns(['publication_id', 'format']).doNothing())
    .executeTakeFirst();
  return inserted.numInsertedOrUpdatedRows === 1n ? 'recorded' : 'already';
}

/** A publication as a reader is shown it: its record, and its outputs by key. */
export interface StoredPublication {
  readonly id: string;
  readonly documentId: string;
  readonly documentVersion: { readonly id: string; readonly number: string };
  readonly title: string;
  readonly publisher: { readonly id: string; readonly displayName: string | null };
  readonly publishedAt: Date;
  readonly approval: 'none';
  readonly formats: readonly PublishingFormat[];
  /** The PDF's engine and template, or none where the publication has no PDF (0027). */
  readonly engine: { readonly name: 'typst'; readonly version: string } | null;
  readonly template: { readonly name: 'publication'; readonly version: number } | null;
  readonly pipelineVersion: string;
  /** One per format, in the order the formats are named: the PDF first. */
  readonly outputs: readonly {
    /** A format it names, or `provenance.json` beside them where it holds a value (B3-G). */
    readonly format: PublishingFormat | 'provenance';
    readonly key: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly standard: 'ua-1' | null;
    readonly producer: 'typst' | 'word' | 'pipeline';
    readonly producerVersion: string;
    readonly report: OutputReport;
    /** What veraPDF found of the PDF, once it has been checked; none before, and none for Word. */
    readonly check: StoredPublicationCheck | null;
    /**
     * Whether the PDF's check was given up for good (0041): its checks gave up as often as the sweep
     * queues them, and none is coming. Never for Word. A check recorded afterwards is what stands.
     */
    readonly checkGaveUp: boolean;
  }[];
}

/** A publication as a listing shows it: its record without its outputs. */
export type PublicationSummary = Omit<StoredPublication, 'outputs'>;

const publicationColumns = [
  'p.id',
  'p.document_id',
  'p.document_version_id',
  'p.published_at',
  'p.approval',
  'p.formats',
  'p.engine_version',
  'p.template_version',
  'p.pipeline_version',
  'pr.id as publisher_id',
  'pr.display_name as publisher_name',
  'v.revision_no',
  'v.version_no',
] as const;

/**
 * One publication, or undefined where this environment holds no publication of that id - a
 * document's or a component's id among them. It decides nothing: `read` on the publication artifact
 * is the caller's to decide, before it asks (decision D).
 */
export async function readPublication(
  trx: TenantTransaction,
  id: string,
): Promise<StoredPublication | undefined> {
  if (!UUID.test(id)) return undefined;
  const row = await trx
    .selectFrom('publication as p')
    .innerJoin('principal as pr', 'pr.id', 'p.publisher')
    .innerJoin('artifact_version as v', 'v.id', 'p.document_version_id')
    .select([...publicationColumns, sql<string>`v.content ->> 'title'`.as('title')])
    .where('p.id', '=', id)
    .executeTakeFirst();
  if (!row) return undefined;
  const outputs = await trx
    .selectFrom('publication_output')
    .select([
      'format',
      'object_key',
      'sha256',
      'bytes',
      'standard',
      'producer',
      'producer_version',
      'report',
    ])
    .where('publication_id', '=', id)
    .execute();
  const checks = await trx
    .selectFrom('publication_check')
    .select([
      'format',
      'checker_version',
      'compliant',
      'failed_rules',
      'report_key',
      'report_sha256',
      'report_bytes',
      'checked_at',
    ])
    .where('publication_id', '=', id)
    .execute();
  const givenUp = await trx
    .selectFrom('publication_check_given_up')
    .select('format')
    .where('publication_id', '=', id)
    .execute();
  // In the order the publication names its formats, the PDF first, and `provenance.json` last.
  const order = (format: PublishingFormat | 'provenance') =>
    format === 'provenance' ? row.formats.length : row.formats.indexOf(format);
  return {
    ...summaryOf(row),
    outputs: outputs
      .sort((a, b) => order(a.format) - order(b.format))
      .map((each) => ({
        format: each.format,
        key: each.object_key,
        sha256: each.sha256,
        bytes: each.bytes,
        standard: each.standard,
        producer: each.producer,
        producerVersion: each.producer_version,
        // Written only by `recordPublication`, which parsed it, and by 0027 as empty: a report that
        // does not parse is a broken store, thrown, as a component that does not read is.
        report: parseOutputReport(each.report),
        check: checkOf(checks.find((check) => check.format === each.format)),
        checkGaveUp: givenUp.some((row) => row.format === each.format),
      })),
  };
}

/** A check as it is stored: 0040's checks hold its failed rules to their shape. */
function checkOf(
  row:
    | {
        readonly checker_version: string;
        readonly compliant: boolean;
        readonly failed_rules: unknown;
        readonly report_key: string;
        readonly report_sha256: string;
        readonly report_bytes: number;
        readonly checked_at: Date;
      }
    | undefined,
): StoredPublicationCheck | null {
  if (row === undefined) return null;
  return {
    checker: 'verapdf',
    checkerVersion: row.checker_version,
    profile: 'ua1',
    compliant: row.compliant,
    failedRules: row.failed_rules as FailedRule[],
    report: { key: row.report_key, sha256: row.report_sha256, bytes: row.report_bytes },
    checkedAt: row.checked_at,
  };
}

/**
 * A document's publications the principal may read, newest first (PUB-048). Filtered in the query by
 * the one readable-set predicate every listing uses, over the **publication** artifacts, so a grant
 * on the document alone reaches none of them (decision D), and one the principal may not read leaves
 * no count, place or gap behind. A publication's time is to the second, so ties are broken by when
 * each was recorded. It does not ask whether the id is a document's: a component's lists nothing,
 * which the caller must answer as no such document. Undefined when the tenant holds no such principal.
 */
export async function listPublications(
  trx: TenantTransaction,
  documentId: string,
  principalId: string,
  request: ListingRequest<SortOf<'publications'>> = { limit: 100 },
  filter: PublicationFilter = {},
): Promise<PublicationPage | undefined> {
  return readablePublications(trx, principalId, documentId, request, filter);
}

/** Narrowing a publications listing: to these spaces, and publications of these documents (SCH-064). */
export interface PublicationFilter {
  readonly spaces?: readonly string[];
  readonly documents?: readonly string[];
}

/** A page of publications, with the total and each facet counted without its own filter. */
export type PublicationPage = Listed<PublicationSummary> & {
  readonly total: number;
  readonly facets: {
    readonly spaces: readonly FacetCount[];
    readonly documents: readonly FacetCount[];
  };
};

/**
 * Every publication the principal may read, of every document, newest first: the per-document
 * listing's query without the document (interface slice 10), filtered by the same readable set over
 * the publication artifacts. Unpaged, as the document listing is. Undefined when the tenant holds no
 * such principal.
 */
export async function listReadablePublications(
  trx: TenantTransaction,
  principalId: string,
  request: ListingRequest<SortOf<'publications'>> = { limit: 100 },
  filter: PublicationFilter = {},
): Promise<PublicationPage | undefined> {
  return readablePublications(trx, principalId, null, request, filter);
}

/**
 * A page of publications by keyset over the sort asked for and then the id, as of the walk's first
 * page's snapshot (API-007, SCH-022): a publication is never changed once recorded, so the snapshot
 * only keeps one recorded since the walk began off its later pages.
 */
async function readablePublications(
  trx: TenantTransaction,
  principalId: string,
  documentId: string | null,
  request: ListingRequest<SortOf<'publications'>>,
  filter: PublicationFilter,
): Promise<PublicationPage | undefined> {
  const limit = checkedLimit(request.limit);
  const sort = request.sort ?? 'published';
  const { types, order: byDefault } = listingSorts.publications[sort];
  if (!isListingRequest(request, types)) {
    throw new Error('A page request names a cursor no listing gave out');
  }
  const readable = await loadReadableSet(trx, principalId);
  if (!readable) return undefined;
  const snapshot = await snapshotFor(trx, request.snapshot);
  /** The publications the reader may read, as of the snapshot, with every filter but `leaving`. */
  const base = (leaving?: keyof PublicationFilter) =>
    trx
      .selectFrom('publication as p')
      .innerJoin('artifact as a', 'a.id', 'p.id')
      .innerJoin('space as s', 's.id', 'a.space_id')
      .innerJoin('principal as pr', 'pr.id', 'p.publisher')
      .innerJoin('artifact_version as v', 'v.id', 'p.document_version_id')
      .select([...publicationColumns, sql<string>`v.content ->> 'title'`.as('title')])
      .select(['s.id as space_id', 's.name as space_name'])
      .select(
        sortColumns(
          sort === 'published'
            ? [sql`p.published_at`, sql`a.created_at`]
            : [sql`v.content ->> 'title'`],
        ),
      )
      .$if(documentId !== null, (query) => query.where('p.document_id', '=', documentId!))
      .where((eb) => readableArtifacts(eb, readable))
      .where(visibleIn('p.written_by', snapshot))
      .$if(filter.spaces !== undefined && leaving !== 'spaces', (query) =>
        filter.spaces!.length === 0
          ? query.where(sql<boolean>`false`)
          : query.where('a.space_id', 'in', [...filter.spaces!]),
      )
      .$if(filter.documents !== undefined && leaving !== 'documents', (query) =>
        filter.documents!.length === 0
          ? query.where(sql<boolean>`false`)
          : query.where('p.document_id', 'in', [...filter.documents!]),
      );
  const { rows, next } = await keysetPage<Parameters<typeof summaryOf>[0]>(
    trx,
    base(),
    types,
    request.order ?? byDefault,
    limit,
    request.after,
  );
  return {
    items: rows.map((row) => summaryOf({ ...row, published_at: new Date(row.published_at) })),
    next,
    snapshot,
    total: await countOf(trx, base()),
    facets: {
      spaces: await facetOf(trx, base('spaces'), 'space_id', 'space_name'),
      // A document by its title at the version each publication made: the latest of them labels it.
      documents: await facetOf(trx, base('documents'), 'document_id', 'title'),
    },
  };
}

function summaryOf(row: {
  id: string;
  document_id: string;
  document_version_id: string;
  title: string;
  published_at: Date;
  approval: 'none';
  formats: PublishingFormat[];
  engine_version: string | null;
  template_version: number | null;
  pipeline_version: string;
  publisher_id: string;
  publisher_name: string | null;
  revision_no: number;
  version_no: number;
}): PublicationSummary {
  return {
    id: row.id,
    documentId: row.document_id,
    documentVersion: {
      id: row.document_version_id,
      number: `${row.revision_no}.${row.version_no}`,
    },
    title: row.title,
    publisher: { id: row.publisher_id, displayName: row.publisher_name },
    publishedAt: row.published_at,
    approval: row.approval,
    formats: row.formats,
    engine: row.engine_version === null ? null : { name: 'typst', version: row.engine_version },
    template:
      row.template_version === null ? null : { name: 'publication', version: row.template_version },
    pipelineVersion: row.pipeline_version,
  };
}
