import { createHash } from 'node:crypto';
import { z } from 'zod';
import { publishedImagePath, type PublishingAsset } from '@alloy-works/domain';
import { renderCitations } from '@alloy-works/domain/citations';
import {
  failPublicationRequest,
  recordPublicationEvent,
  setAuditContext,
  publicationInputs,
  recordPreview,
  recordPublication,
  type NewPublicationOutput,
  type PublicationInputs,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  assemble,
  canonicalResultSchema,
  OUTPUT_CONTENT_TYPES,
  provenanceBytes,
  publishedProvenance,
  revisionCellKey,
  PUBLISHING_SCHEMA_1,
  WORD_WRITER_VERSION,
  writeDocx,
  type ContentDocument,
  type HeldDataset,
  type Held,
  type PublishFailure,
  type WideTable,
} from '@alloy-works/domain';
import { tenantPrefix, type ObjectStores, type TenantStore } from '@alloy-works/objects';
import {
  PINNED_FONT_FILES,
  pinnedFacesByHash,
  typefacesNotHeld,
  type PinnedFonts,
} from '../fonts.js';
import { JobRefused } from '../refusal.js';
import { leakedFrom } from '../scan.js';
import {
  PUBLICATION_TEMPLATE,
  PUBLISHING_SCHEMA_CURRENT,
  TEMPLATE_READING,
  type PublishedSchema,
} from '../template.js';
import type { RootImage, Typst } from '../typst.js';
import type { JobHandler } from '../worker.js';

/**
 * The pipeline's own version (PUB-063), by the schema of the document it makes: `assemble` and this
 * job, as one, and the words `assemble` carries into every page - the draft notice, and since layouts
 * the layout's words - which the template's hash does not cover, because they are the data's. Raised
 * with any of them; `template.test.ts` holds what each version's `assemble` makes of one fixed input,
 * notice included. Version 1 is still made, for a request made before layouts (Ken's answer F);
 * version 2 is what a request under a layout made before a run carried its marks, version 3 what
 * one made before a block could be a list, version 4 before one could be a quotation, and version 5
 * before one could be a table, and version 6 before one could be a figure - each named only by the
 * publications it made. Version 6 was also the first whose compile runs with
 * `--features a11y-extras` (`typstArguments`), 7 the first to read images from the store, 8 the
 * first to set one in a run of text, 9 the first to set a footnote and a table's note, 10 the
 * first to resolve and print a cross-reference, 11 the first to set an equation, 12 the first to
 * be set from the theme the request was made under, 13 the first to set a table and an image from
 * their styles, 14 the first to leave a table or a figure marked unnumbered out of the list of its
 * kind, 15 the first to set a table's or a figure's caption where its style places it, 16 the
 * first to set a bound value, read from its stored result, and make `provenance.json` beside it, and
 * 17 the first to set a bound image and write `provenance.json` at its schema 2 (the B6 plan), 18
 * the first to lay out and set a bound table and write `provenance.json` at its schema 3 (TB1-J), 19
 * the first to letter a table's notes beneath it and place a bound table's (TB3-K), 20 the first
 * to query the template before it compiles, scaling or turning a table too wide (TB3-H, TB3-I), 21
 * the first to set a bound table's groups under their headings and record them (TG1), 22 the first
 * to set a transposed table (TG2), 23 the first to measure a table's columns by what they hold
 * (TG3), 24 the first to print a value revised by hand and write `provenance.json` at its schema 4
 * (the RV plan, RV-F), 25 the first to publish a gate's baseline as approved, without the notice
 * and with its approval page (the WF2 plan, WF2-I, WF2-J), 26 the first to print a variable and
 * write `provenance.json` at its schema 5 (the R5 plan, R5-E), and 27 the first to print a citation
 * and its bibliography (the CI plan, CIc).
 *
 * **Both keys are frozen.** Keyed by `PUBLISHING_SCHEMA` itself, a repoint moved the key while the
 * value stayed behind, and the `satisfies` clause could not catch it because `PublishedSchema`
 * derives from the same constant: every publication the new pipeline made would record itself as
 * made by the old one, in the single field this constant exists for. `PUBLISHING_SCHEMA_CURRENT` is
 * annotated with its literal, so a repoint fails the typecheck where it is declared, and
 * `template.test.ts` still pins this map as a LITERAL object so that a bump left half-done goes red
 * rather than lying in a PDF's own provenance.
 */
export const PIPELINE_VERSION = {
  [PUBLISHING_SCHEMA_1]: '1',
  [PUBLISHING_SCHEMA_CURRENT]: '27',
} as const satisfies Record<PublishedSchema, string>;

/** The document's own failures, every one at once: the job is finished, never tried again. */
export class PublishRefused extends JobRefused {
  constructor(readonly failures: readonly PublishFailure[]) {
    super('publish_refused', 'The document cannot be published as it stands.');
  }
}

/** The store would not take the output, or the database its record. Worth another attempt. */
class StoreFailed extends Error {
  readonly code = 'store_failed';
}

/**
 * Every image the request recorded, read from the tenant's store and placed where the published
 * document names it (figures 3, ruling R7): `assets/<sha256>.<extension>`, the hash its key ends in and
 * the extension its format declares. The bytes are held to that hash before they are handed on, as the
 * faces are, so neither Typst nor the Word writer reads an image that is not the one recorded (Word 2,
 * ruling R3). Bytes that are not are a broken store: thrown, never a refusal, so the job is tried again
 * and then failed at the engine's stage.
 */
export async function rootImages(
  assets: ReadonlyMap<string, PublishingAsset>,
  get: (key: string) => Promise<Uint8Array>,
): Promise<RootImage[]> {
  const images: RootImage[] = [];
  for (const asset of assets.values()) {
    const hash = asset.object.slice(asset.object.lastIndexOf('/') + 1);
    const bytes = await get(asset.object);
    if (createHash('sha256').update(bytes).digest('hex') !== hash) {
      throw new Error(`The bytes under ${asset.object} are not the bytes it names`);
    }
    // The place the published document names it at, by the one rule that names it.
    images.push({ path: publishedImagePath(asset), bytes });
  }
  return images;
}

/**
 * The platform's failure, as the request records it: its stage and nothing an author could act on -
 * no node, no block, no detail - so a face changed under a running worker, a crash or a lost
 * connection never reads as something wrong with the document.
 */
const platformFailure = (stage: 'engine' | 'store'): PublishFailure => ({
  stage,
  code: stage === 'store' ? 'store_failed' : 'engine_failed',
  node: null,
  block: null,
  detail: null,
});

/**
 * **Each binding's result, read from the store and never a source** (DAT-088; the B3 plan, B3-F): each
 * distinct dataset version the request recorded read once, by its checksum's key, and held to it and
 * to the canonical shape. A missing object, altered bytes or a result that does not parse is
 * `unreadable` for every binding taking it, which the binding stage fails `result_unreadable` - never
 * retried, since a missing object never comes back.
 */
export async function heldResults(
  bindings: PublicationInputs['bindings'],
  get: (key: string) => Promise<Uint8Array>,
  prefix: string,
): Promise<Map<string, Map<string, Held>>> {
  const read = new Map<string, Promise<Held>>();
  const readOnce = (
    version: string,
    dataset: HeldDataset,
    key: readonly string[],
  ): Promise<Held> => {
    let held = read.get(version);
    if (held === undefined) {
      held = (async (): Promise<Held> => {
        const { checksum, columns } = dataset.provenance;
        try {
          const bytes = await get(`${prefix}sha256/${checksum}`);
          if (createHash('sha256').update(bytes).digest('hex') !== checksum) return 'unreadable';
          const parsed = canonicalResultSchema.safeParse(
            JSON.parse(Buffer.from(bytes).toString('utf8')),
          );
          if (!parsed.success) return 'unreadable';
          return {
            result: parsed.data,
            columns,
            datasetVersion: version,
            definition: dataset.provenance.queryDefinition.artifact,
            images: dataset.provenance.images,
            key,
          };
        } catch {
          return 'unreadable';
        }
      })();
      read.set(version, held);
    }
    return held;
  };
  const byNode = new Map<string, Map<string, Held>>();
  for (const [node, held] of bindings) {
    const results = new Map<string, Held>();
    for (const [binding, recorded] of held) {
      const result = await readOnce(recorded.datasetVersion, recorded.dataset, recorded.key);
      // The revisions the request read stand in front of it (the RV plan, RV-E, RV-F).
      results.set(
        binding,
        result === 'unreadable' || recorded.revisions.length === 0
          ? result
          : {
              ...result,
              revisions: new Map(
                recorded.revisions.map((each) => [revisionCellKey(each.cell), each]),
              ),
            },
      );
    }
    byNode.set(node, results);
  }
  return byNode;
}

/**
 * **What template 18 says of each table it set** (TB3-H, TB3-I), labelled `aw-wide`: its node and its
 * identifier, its least width and its measure in points, the scale it was set at or null, whether it was
 * turned onto landscape pages, and why it cannot be published, or null. Checked before it is believed:
 * an answer of any other shape is the engine's failure, never the document's.
 */
const wideAnswerSchema = z.array(
  z.strictObject({
    node: z.string().min(1),
    table: z.string().min(1),
    width: z.number(),
    measure: z.number(),
    scale: z.number().positive().nullable(),
    rotate: z.boolean(),
    fails: z.enum(['narrow', 'tall', 'turned']).nullable(),
  }),
);

/** The label template 18 puts on each table's answer, which the query names. */
export const WIDE_LABEL = 'aw-wide';

/**
 * Each table's answer, from the template itself before it is compiled (TB3-I): Typst asked once, its
 * answer checked, so `table_too_wide` fails by name, every table at once, before the compile, and Word
 * is told which tables the PDF scaled and which it turned.
 */
export async function wideTables(
  typst: Typst,
  template: string,
  data: string,
  createdAt: Date,
  images: readonly RootImage[],
): Promise<z.infer<typeof wideAnswerSchema>> {
  const answer = wideAnswerSchema.safeParse(
    await typst.query(template, data, WIDE_LABEL, createdAt, images),
  );
  if (!answer.success) throw new Error("The template's answer for its tables is not one it gives");
  const failures: PublishFailure[] = answer.data.flatMap((each) =>
    each.fails === null
      ? []
      : [
          {
            stage: 'compose' as const,
            code: 'table_too_wide' as const,
            node: each.node,
            block: each.table,
            detail: each.fails,
          },
        ],
  );
  if (failures.length > 0) throw new PublishRefused(failures);
  return answer.data;
}

/** `provenance.json`'s content type: kept and served as JSON. */
const PROVENANCE_CONTENT_TYPE = 'application/json';

/** One output into the tenant's store by its hash, as its format's content type. */
/** An output kept in the tenant's store: its key, digest and size. */
type Kept = Awaited<ReturnType<typeof keep>>;

async function keep(store: TenantStore, bytes: Uint8Array, format: 'pdf' | 'docx' | 'provenance') {
  try {
    return await store.put(
      bytes,
      format === 'provenance' ? PROVENANCE_CONTENT_TYPE : OUTPUT_CONTENT_TYPES[format],
    );
  } catch (error) {
    throw new StoreFailed('The store did not take the publication.', { cause: error });
  }
}

/**
 * A request's recorded inputs through `assemble`, as its job reads them (PUB-006): each value from its
 * stored result, every pinned face, and the status the pages say. A range preview hands `content`, the
 * occurrence content it shows in place of what the request recorded: its author's latest iteration
 * of the component being edited (the R22 plan, R22-B).
 */
export async function assembleRequest(
  deps: {
    readonly fonts: PinnedFonts;
    readonly conditionContent?: (node: string, content: ContentDocument) => ContentDocument;
  },
  inputs: PublicationInputs,
  store: TenantStore,
  tenant: Tenant,
  options: {
    readonly status: 'preview' | 'approved' | 'draft';
    readonly content?: (node: string, recorded: ContentDocument) => ContentDocument | undefined;
  },
) {
  const {
    request,
    outline,
    refused,
    layout,
    theme,
    revision,
    approved,
    assets,
    boundAssets,
    variables,
    profile,
  } = inputs;
  const { formats } = request;
  const held = await heldResults(inputs.bindings, (key) => store.get(key), tenantPrefix(tenant));
  // Every pinned face by its hash, checked as a compile checks them, which a table's columns are
  // measured by where its style widths them by what they hold (TG3), and Word embeds.
  const faces = await pinnedFacesByHash(deps.fonts.directory);
  return assemble({
    faces,
    // A preview says so on every page in the layout's words (PUB-005), and is otherwise assembled
    // exactly as a publish of the same request would be (PUB-006).
    // An approved one - made from a baseline taken at a gate - says nothing of being a draft
    // (PUB-004), and lists its approvals where its layout declares an approval page (PUB-089).
    status: options.status,
    ...(approved ? { approvals: approved.approvals } : {}),
    // Told the formats, so it refuses what only the PDF's engine cannot set where a PDF is asked
    // for, and what Word cannot carry yet where Word is (Word 1, rulings R2 and R3): a request for
    // both fails if either would, before either output is made.
    formats,
    outline,
    occurrences: new Map(
      [...inputs.occurrences].map(([node, each]) => [
        node,
        options.content?.(node, each.content) ?? each.content,
      ]),
    ),
    // The binding stage's results, by node and binding: a preview takes and fails as a publish does.
    bindings: held,
    // What its variables resolve by: the declared ones, and the document's parameters and values.
    variables,
    // The profile it was made under, which selects each occurrence's conditional content (R6-F).
    profile: { values: profile.values, excludeUnset: profile.excludeUnset === true },
    refused,
    // The layout version the request was made under, never the latest; none for a request made
    // before layouts, which `assemble` makes `publishing/1` of, as the first slice did.
    layout: layout?.layout ?? null,
    // And the theme version, which a request made before layouts has none of, as it has no layout
    // (migration 0024).
    theme: theme?.theme ?? null,
    revision,
    covers: deps.fonts.covers,
    // The request's own images, and every one a held result could place (B6-F): the binding
    // stage sets a bound image as an ordinary one, naming its asset version, sized from these.
    assets: new Map([...boundAssets, ...assets]),
    // Each entry version the request recorded and its theme's style, rendered by citeproc here (CIc).
    citations: { ...inputs.citations, render: renderCitations },
    ...(deps.conditionContent ? { conditionContent: deps.conditionContent } : {}),
  });
}

/**
 * One publish: the recorded inputs through `assemble` once, for every format the request names; the
 * published document through the pinned Typst and the fixed template for the PDF, and through the
 * Word writer for Word; each output into the tenant's store by its hash, and the publication recorded
 * whole, every output or none (docs/design/publishing.md, "The request and the job"; Word 1, ruling
 * R12). The worker decides nothing: the request recorded, as its publisher, which formats it asked
 * for, which version each occurrence takes and which it could not read, and this reads exactly those.
 *
 * **It runs a preview too** (publishing.md, "Preview"; PUB-006), registered for the `preview` job and
 * told which it is by the request, never by the job: the same inputs through the same `assemble`, told
 * the status, so every page says it is a preview (PUB-005); the PDF alone, which is all a preview asks
 * for, kept in the same store the same way; and ended by `recordPreview`, which records the PDF on the
 * request and no publication. A preview fails as a publish does, by `failed`, in the same words.
 */
export function publishJob(deps: {
  readonly db: TenantDatabase;
  readonly stores: ObjectStores;
  readonly typst: Typst;
  readonly fonts: PinnedFonts;
  /**
   * The conditions stage, handed to `assemble`: REU's, in T4, and the identity until then. A test
   * hands one to remove a block before binding.
   */
  readonly conditionContent?: (node: string, content: ContentDocument) => ContentDocument;
}): JobHandler {
  return {
    async run(tenant, job) {
      // Nothing enqueues a publish job without a subject; a row that did would otherwise match no
      // request and complete silently as `done`, with no publication and no record of the attempt.
      if (!job.subjectId) throw new JobRefused('no_subject', 'A publish job must name a request.');
      const read = await deps.db.withTenant(tenant, async (trx) => ({
        inputs: await publicationInputs(trx, job.subjectId!),
        store: await deps.stores.forTenant(trx, tenant),
      }));
      // Nothing to do: finished by another attempt.
      if (!read.inputs) return;
      const { request, theme, approved, assets, bindings, boundAssets } = read.inputs;

      // The theme's faces held to the pinned files before anything is composed (themes 1, ruling R5,
      // and the final review's M1): a typeface the worker does not hold exactly - its files, their
      // metrics, a maths face's MATH table - could set nothing, set it where the theme did not mean,
      // or refuse the compile unnamed, and `assemble` would refuse each of its characters in turn
      // without once naming it. Refused as the document's own failures are, by the same list and the
      // same record, naming each family and why: `<family>: <files | metrics | maths>`, a family the
      // theme wrote, whose name cannot hold a colon, and a word from a fixed list, never a value.
      const unheld = theme === null ? [] : typefacesNotHeld(theme.theme, deps.fonts);
      if (unheld.length > 0) {
        throw new PublishRefused(
          unheld.map(({ family, detail }) => ({
            stage: 'compose',
            code: 'typeface_unavailable',
            node: null,
            block: null,
            detail: `${family}: ${detail}`,
          })),
        );
      }

      const { formats } = request;
      const preview = request.kind === 'preview';
      // Each value from its stored result, read from the store by its checksum, never from a source:
      // the worker holds no connector and no connection's configuration (DAT-088).
      const assembled = await assembleRequest(deps, read.inputs, read.store, tenant, {
        status: preview ? 'preview' : approved ? 'approved' : 'draft',
      });
      if (!assembled.ok) throw new PublishRefused(assembled.failures);

      // Chosen by what `assemble` made, so a document is never handed to a template that cannot read
      // it: template 1 and pipeline 1 for `publishing/1`, template 9 and pipeline 9 for `publishing/9`.
      // A publication under template 9 must name a layout, which only a request made under one has.
      const { schema } = assembled.document;
      // The digest is of the bytes Typst reads, so a reproduction can tell input from engine. The Word
      // writer reads the same document, made by the same `assemble`, so it names what Word was made
      // from too.
      const data = JSON.stringify(assembled.document);
      const outputs: NewPublicationOutput[] = [];
      // Each output made, and kept only once every one has been scanned (REU-048; R6-G): a passage
      // its conditions took out that reaches any of them fails the publish, and nothing is stored.
      const made: { bytes: Uint8Array; format: 'pdf' | 'docx'; record: (stored: Kept) => void }[] =
        [];
      // Read once, for whichever outputs are asked for: the same bytes by the same paths. Of a held
      // result's images, only those the binding stage placed (B6-F), never every one a result holds.
      const placed = new Map(assets);
      for (const value of assembled.values) {
        if (!('image' in value)) continue;
        const bound = boundAssets.get(value.image.assetVersion);
        if (bound !== undefined) placed.set(value.image.assetVersion, bound);
      }
      const images = await rootImages(placed, (key) => read.store.get(key));
      const template = PUBLICATION_TEMPLATE[TEMPLATE_READING[schema]];
      // Asked of the template before anything is made (TB3-I): a table it cannot set whole fails the
      // publish by name, and Word sets each table as the PDF does. Template 1 sets no wide table.
      const wide =
        schema === PUBLISHING_SCHEMA_1
          ? []
          : await wideTables(deps.typst, template.file, data, request.compiledAt, images);
      if (formats.includes('pdf')) {
        // At the request's time, or a baseline's own, so every publish of one is the same bytes (BL-F).
        const pdf = await deps.typst.compile(template.file, data, request.compiledAt, images);
        const engineVersion = await deps.typst.version();
        made.push({
          bytes: pdf,
          format: 'pdf',
          record: (stored) =>
            outputs.push({
              format: 'pdf',
              engineVersion,
              templateVersion: template.version,
              key: stored.key,
              sha256: stored.sha256,
              bytes: stored.size,
            }),
        });
      }
      if (formats.includes('docx')) {
        // `assemble` answers Word's inputs, and a document under a layout, wherever Word is asked for
        // and it did not refuse: a request made before layouts is refused `format_unsupported`.
        const { document, word } = assembled;
        if (word === null || document.schema === PUBLISHING_SCHEMA_1) {
          throw new Error('assemble answered no Word inputs for a request that asked for Word');
        }
        const { bytes, report } = writeDocx({
          document,
          numbering: assembled.numbering,
          word,
          formats,
          // The theme's faces were held to exactly these files above, so every file it names is here.
          faces: await pinnedFacesByHash(deps.fonts.directory),
          images: new Map(images.map((image) => [image.path, image.bytes])),
          // How the PDF set each table too wide for its measure (TB3-J).
          wide: wide.flatMap(({ node, table, scale, rotate }): WideTable[] =>
            rotate
              ? [{ node, block: table, set: 'rotated' }]
              : scale === null
                ? []
                : [{ node, block: table, set: 'scaled' }],
          ),
        });
        made.push({
          bytes,
          format: 'docx',
          record: (stored) =>
            outputs.push({
              format: 'docx',
              writerVersion: WORD_WRITER_VERSION,
              report,
              key: stored.key,
              sha256: stored.sha256,
              bytes: stored.size,
            }),
        });
      }
      const leaks: PublishFailure[] = [];
      for (const each of made) {
        if ((await leakedFrom(assembled.probes, each.format, each.bytes)).length > 0) {
          // Named by its format alone: the failure never repeats the text it found.
          leaks.push({
            stage: 'engine',
            code: 'condition_leaked',
            node: null,
            block: null,
            detail: each.format,
          });
        }
      }
      if (leaks.length > 0) throw new PublishRefused(leaks);
      for (const each of made) each.record(await keep(read.store, each.bytes, each.format));
      // `provenance.json` beside the outputs wherever a value is printed (B3-G; DAT-042, PUB-049): a
      // publication's alone, since a preview records no publication (B3-H). Wherever the request
      // recorded a binding, as `recordPublication` counts them, even where a condition took every
      // bound block out before binding: it lists what printed, which may be nothing.
      const recordedABinding = [...bindings.values()].some((each) => each.size > 0);
      if (!preview && (recordedABinding || assembled.variables.length > 0)) {
        const datasets = new Map(
          [...bindings.values()].flatMap((each) =>
            [...each.values()].map(
              (recorded) => [recorded.datasetVersion, recorded.dataset] as const,
            ),
          ),
        );
        const bytes = provenanceBytes(
          publishedProvenance(assembled.values, datasets, assembled.numbering, assembled.variables),
        );
        const stored = await keep(read.store, bytes, 'provenance');
        outputs.push({
          format: 'provenance',
          pipelineVersion: PIPELINE_VERSION[schema],
          key: stored.key,
          sha256: stored.sha256,
          bytes: stored.size,
        });
      }
      if (preview) {
        // The PDF alone, which is all a preview asks for (0035 holds its request to it), recorded on
        // the request, in its own transaction, as a publication is: a record the database refuses is
        // the store stage's, and the object stays behind, keyed by its hash, and nothing refers to it.
        const [pdf] = outputs;
        if (pdf?.format !== 'pdf' || outputs.length !== 1) {
          throw new Error('A preview is the PDF alone, and this one made something else');
        }
        await deps.db
          .withTenant(tenant, (trx) =>
            recordPreview(trx, {
              requestId: request.id,
              key: pdf.key,
              sha256: pdf.sha256,
              bytes: pdf.bytes,
            }),
          )
          .catch((error: unknown) => {
            throw new StoreFailed('The preview could not be recorded.', { cause: error });
          });
        return;
      }
      // Its own transaction: a record that fails ends it, rolled back whole, and the request is failed
      // - after the last attempt - in a fresh one by `failed`, never in the one that caught the error.
      // Every output was made, so a record the database refuses is the store stage's, like a refused
      // put: the objects stay behind, keyed by their hashes, and nothing refers to them. So does an
      // output kept before another could not be, or be made.
      // As the system, for the requester, with its event in the same transaction (the AU1 plan, AU1-L).
      await deps.db
        .withTenant(
          tenant,
          async (trx) => {
            const publication = await recordPublication(trx, {
              requestId: request.id,
              pipelineVersion: PIPELINE_VERSION[schema],
              // `compile` and `pinnedFacesByHash` re-hashed the faces against these very pins.
              fonts: PINNED_FONT_FILES.map(({ file, sha256 }) => ({ file, sha256 })),
              dataSha256: createHash('sha256').update(data).digest('hex'),
              numbering: assembled.numbering,
              // One per format the request names, the PDF first, or none: whole or absent.
              outputs,
            });
            if (publication !== undefined) {
              await recordPublicationEvent(
                trx,
                'publication.produced',
                { document: request.documentId, version: request.documentVersionId },
                { request: request.id, publication },
              );
            }
          },
          { actorKind: 'system', requestedBy: request.requestedBy },
        )
        .catch((error: unknown) => {
          throw new StoreFailed('The publication could not be recorded.', { cause: error });
        });
    },

    /**
     * The request fails with the document's own list, or - after the last attempt, or when a worker
     * never came back - with the platform's stage and nothing an author could act on.
     */
    async failed(tenant, job, cause) {
      if (!job.subjectId) return;
      const failures: readonly PublishFailure[] =
        cause instanceof PublishRefused
          ? cause.failures
          : [platformFailure(cause instanceof StoreFailed ? 'store' : 'engine')];
      await deps.db.withTenant(
        tenant,
        async (trx) => {
          const failed = await failPublicationRequest(trx, job.subjectId!, failures);
          // A publish's failure is on the log, as the system for whoever asked; a preview's is not.
          if (failed?.kind !== 'publish') return;
          await setAuditContext(trx, { actorKind: 'system', requestedBy: failed.requestedBy });
          await recordPublicationEvent(
            trx,
            'publication.failed',
            { document: failed.documentId, version: failed.documentVersionId },
            {
              request: job.subjectId!,
              codes: [...new Set(failures.map((failure) => failure.code))],
            },
          );
        },
        { actorKind: 'system' },
      );
    },
  };
}
