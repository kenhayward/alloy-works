import {
  parseAssetVersion,
  parseOutputReport,
  PUBLISHING_FORMATS,
  readContent,
  readLayout,
  readOutline,
  speaksFor,
  unsupportedFormats,
  walkOutline,
  type ContentDocument,
  type Layout,
  type NumberingTable,
  type OutlineDocument,
  type OutputReport,
  type PublishFailure,
  type PublishingAsset,
  type PublishingFormat,
  type ResolvedTheme,
  type BlockNode,
  type InlineNode,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { readableComponents } from './documents.js';
import { defaultLayout } from './layouts.js';
import { enqueueJob } from './queue.js';
import { readableArtifacts } from './readable-artifacts.js';
import type { TenantTransaction } from './tables.js';
import { defaultTheme, themeAt } from './themes.js';
import { latestVersion } from './versions.js';

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
        return [{ block: block.id, asset: block.asset }, ...inRuns(block.caption, block.id)];
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
 * paragraph's text, a term, an attribution, a caption, a table's note and every cell. Preformatted
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
   * The current version by its id alone - its outline names components and pinned versions the
   * caller may not read, so it is never handed back from here (IAM-073).
   */
  | { readonly answer: 'version.precondition'; readonly current: string }
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
  | { readonly answer: 'document.missing' };

/**
 * One publish asked for, decided and recorded in the caller's transaction (docs/design/publishing.md,
 * "Who may publish"): `publish` has been decided on the document before this runs, under the access
 * epoch's shared lock. It is made under the environment's declared layout, and refuses a stale version,
 * a format that layout does not make or a document in another language than its words before recording
 * anything; otherwise it resolves every occurrence **as the publisher**, refuses a request without the
 * PDF whose document cites a page (PUB-074), and records the request with the failures resolving
 * found - each naming its node and nothing else (issue #143) - one row per resolved occurrence, and the
 * job, all in one transaction. A request with failures is still queued: `assemble` adds its own for
 * what the publisher can read, and the author is told once (PUB-052). The formats are recorded PDF
 * first, whichever order they were asked in: a set, spelled one way.
 */
export async function requestPublication(
  trx: TenantTransaction,
  input: {
    readonly documentId: string;
    readonly version: string;
    readonly formats: readonly string[];
    readonly requester: string;
  },
): Promise<PublicationRequestAnswer> {
  const latest = await latestVersion(trx, input.documentId);
  if (!latest || latest.kind !== 'document') return { answer: 'document.missing' };
  if (latest.id !== input.version) return { answer: 'version.precondition', current: latest.id };

  // Made under the environment's declared layout at its latest version, recorded by its key: the job
  // publishes under that version, whatever the layout becomes before it runs.
  const layout = await defaultLayout(trx);
  const unsupported = unsupportedFormats(layout.layout, input.formats);
  if (unsupported.length > 0) return { answer: 'format.unsupported', formats: unsupported };
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
  const images = await resolveImages(trx, resolved, input.requester);
  // Set from the environment's declared theme at its latest version, recorded by its key beside the
  // layout's (themes 1, ruling R5): the version names its catalogues' versions, so the job sets the
  // publication from exactly what was declared now, whatever the theme becomes before it runs. Read
  // whole, so a declared theme that does not read is a broken store here rather than in the job.
  const theme = await defaultTheme(trx);
  const request = await trx
    .insertInto('publication_request')
    .values({
      document_id: input.documentId,
      document_version_id: latest.id,
      // Every one named is one the layout makes, which is one of these, checked above.
      formats: PUBLISHING_FORMATS.filter((format) => input.formats.includes(format)),
      requested_by: input.requester,
      failures: JSON.stringify([...failures, ...images.failures]),
      layout_id: layout.artifactId,
      layout_version_id: layout.versionId,
      theme_id: theme.artifactId,
      theme_version_id: theme.versionId,
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
  await enqueueJob(trx, 'publish', request.id);
  return { answer: 'requested', request: { id: request.id, state: 'queued' } };
}

/** What the worker assembles from: everything recorded at the request, read as the tenant. */
export interface PublicationInputs {
  readonly request: {
    readonly id: string;
    readonly documentId: string;
    readonly documentVersionId: string;
    readonly requestedBy: string;
    readonly requestedAt: Date;
    readonly spaceId: string;
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
      'r.document_id',
      'r.document_version_id',
      'r.requested_by',
      'r.requested_at',
      'r.state',
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
  return {
    request: {
      id: request.id,
      documentId: request.document_id,
      documentVersionId: request.document_version_id,
      requestedBy: request.requested_by,
      requestedAt: request.requested_at,
      spaceId: request.space_id!,
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
  if (!request || request.state !== 'queued') return undefined;
  if (request.failures.length > 0) {
    throw new Error(
      `The request ${request.id} carries failures, so it has no publication to record: fail it instead`,
    );
  }
  const made = input.outputs.map((each) => each.format);
  if (
    made.length !== request.formats.length ||
    !request.formats.every((format) => made.includes(format))
  ) {
    throw new Error(
      `The request ${request.id} asked for ${request.formats.join(', ')}, and a publication records one output per format it asked for: ${made.join(', ') || 'none'} is not that`,
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
    const id = await insertPublication(trx, request, input);
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
          : {
              standard: null,
              producer: 'word' as const,
              producer_version: each.writerVersion,
              report: JSON.stringify(each.report),
            }),
      })),
    )
    .execute();
  await trx
    .updateTable('publication_request')
    .set({ state: 'done', finished_at: sql<Date>`now()` })
    .where('id', '=', request.id)
    .execute();
  return artifact.id;
}

/** A request as its requester is shown it. */
export interface StoredPublicationRequest {
  readonly id: string;
  readonly documentId: string;
  readonly requestedBy: string;
  readonly state: 'queued' | 'done' | 'failed';
  readonly failures: readonly PublishFailure[];
  readonly publication: string | null;
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
      'r.state',
      'r.failures',
      'p.id as publication',
    ])
    .where('r.id', '=', id)
    .executeTakeFirst();
  return (
    row && {
      id: row.id,
      documentId: row.document_id,
      requestedBy: row.requested_by,
      state: row.state,
      failures: row.failures as PublishFailure[],
      publication: row.publication,
    }
  );
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
    readonly format: PublishingFormat;
    readonly key: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly standard: 'ua-1' | null;
    readonly producer: 'typst' | 'word';
    readonly producerVersion: string;
    readonly report: OutputReport;
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
  // In the order the publication names its formats, the PDF first.
  const order = (format: PublishingFormat) => row.formats.indexOf(format);
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
      })),
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
): Promise<readonly PublicationSummary[] | undefined> {
  return readablePublications(trx, principalId, documentId);
}

/**
 * Every publication the principal may read, of every document, newest first: the per-document
 * listing's query without the document (interface slice 10), filtered by the same readable set over
 * the publication artifacts. Unpaged, as the document listing is. Undefined when the tenant holds no
 * such principal.
 */
export async function listReadablePublications(
  trx: TenantTransaction,
  principalId: string,
): Promise<readonly PublicationSummary[] | undefined> {
  return readablePublications(trx, principalId, null);
}

async function readablePublications(
  trx: TenantTransaction,
  principalId: string,
  documentId: string | null,
): Promise<readonly PublicationSummary[] | undefined> {
  const readable = await loadReadableSet(trx, principalId);
  if (!readable) return undefined;
  const rows = await trx
    .selectFrom('publication as p')
    .innerJoin('artifact as a', 'a.id', 'p.id')
    .innerJoin('principal as pr', 'pr.id', 'p.publisher')
    .innerJoin('artifact_version as v', 'v.id', 'p.document_version_id')
    .select([...publicationColumns, sql<string>`v.content ->> 'title'`.as('title')])
    .$if(documentId !== null, (query) => query.where('p.document_id', '=', documentId!))
    .where((eb) => readableArtifacts(eb, readable))
    .orderBy('p.published_at', 'desc')
    .orderBy('a.created_at', 'desc')
    .orderBy('p.id')
    .execute();
  return rows.map(summaryOf);
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
