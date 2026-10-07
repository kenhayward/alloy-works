import { createHash } from 'node:crypto';
import { publishedImagePath, type PublishingAsset } from '@alloy-works/domain';
import {
  failPublicationRequest,
  publicationInputs,
  recordPreview,
  recordPublication,
  type NewPublicationOutput,
  type PublicationInputs,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  assemble,
  canonicalResultSchema,
  OUTPUT_CONTENT_TYPES,
  provenanceBytes,
  publishedProvenance,
  PUBLISHING_SCHEMA_1,
  WORD_WRITER_VERSION,
  writeDocx,
  type ContentDocument,
  type HeldDataset,
  type Held,
  type PublishFailure,
} from '@alloy-works/domain';
import { tenantPrefix, type ObjectStores, type TenantStore } from '@alloy-works/objects';
import {
  PINNED_FONT_FILES,
  pinnedFacesByHash,
  typefacesNotHeld,
  type PinnedFonts,
} from '../fonts.js';
import { JobRefused } from '../refusal.js';
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
 * the first to lay out and set a bound table and write `provenance.json` at its schema 3 (TB1-J), and
 * 19 the first to letter a table's notes beneath it and place a bound table's (TB3-K).
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
  [PUBLISHING_SCHEMA_CURRENT]: '19',
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
      results.set(binding, await readOnce(recorded.datasetVersion, recorded.dataset, recorded.key));
    }
    byNode.set(node, results);
  }
  return byNode;
}

/** `provenance.json`'s content type: kept and served as JSON. */
const PROVENANCE_CONTENT_TYPE = 'application/json';

/** One output into the tenant's store by its hash, as its format's content type. */
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
      const {
        request,
        outline,
        occurrences,
        refused,
        layout,
        theme,
        revision,
        assets,
        bindings,
        boundAssets,
      } = read.inputs;

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
      const held = await heldResults(bindings, (key) => read.store.get(key), tenantPrefix(tenant));
      const assembled = assemble({
        // A preview says so on every page in the layout's words (PUB-005), and is otherwise assembled
        // exactly as a publish of the same request would be (PUB-006).
        status: preview ? 'preview' : 'draft',
        // Told the formats, so it refuses what only the PDF's engine cannot set where a PDF is asked
        // for, and what Word cannot carry yet where Word is (Word 1, rulings R2 and R3): a request for
        // both fails if either would, before either output is made.
        formats,
        outline,
        occurrences: new Map([...occurrences].map(([node, each]) => [node, each.content])),
        // The binding stage's results, by node and binding: a preview takes and fails as a publish does.
        bindings: held,
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
        ...(deps.conditionContent ? { conditionContent: deps.conditionContent } : {}),
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
      // Read once, for whichever outputs are asked for: the same bytes by the same paths. Of a held
      // result's images, only those the binding stage placed (B6-F), never every one a result holds.
      const placed = new Map(assets);
      for (const value of assembled.values) {
        if (!('image' in value)) continue;
        const bound = boundAssets.get(value.image.assetVersion);
        if (bound !== undefined) placed.set(value.image.assetVersion, bound);
      }
      const images = await rootImages(placed, (key) => read.store.get(key));
      if (formats.includes('pdf')) {
        const template = PUBLICATION_TEMPLATE[TEMPLATE_READING[schema]];
        const pdf = await deps.typst.compile(template.file, data, request.requestedAt, images);
        const engineVersion = await deps.typst.version();
        const stored = await keep(read.store, pdf, 'pdf');
        outputs.push({
          format: 'pdf',
          engineVersion,
          templateVersion: template.version,
          key: stored.key,
          sha256: stored.sha256,
          bytes: stored.size,
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
          // Every pinned face by its hash, checked again as a compile checks them: the theme's faces
          // were held to exactly these files above, so every file it names is here.
          faces: await pinnedFacesByHash(deps.fonts.directory),
          images: new Map(images.map((image) => [image.path, image.bytes])),
        });
        const stored = await keep(read.store, bytes, 'docx');
        outputs.push({
          format: 'docx',
          writerVersion: WORD_WRITER_VERSION,
          report,
          key: stored.key,
          sha256: stored.sha256,
          bytes: stored.size,
        });
      }
      // `provenance.json` beside the outputs wherever a value is printed (B3-G; DAT-042, PUB-049): a
      // publication's alone, since a preview records no publication (B3-H). Wherever the request
      // recorded a binding, as `recordPublication` counts them, even where a condition took every
      // bound block out before binding: it lists what printed, which may be nothing.
      const recordedABinding = [...bindings.values()].some((each) => each.size > 0);
      if (!preview && recordedABinding) {
        const datasets = new Map(
          [...bindings.values()].flatMap((each) =>
            [...each.values()].map(
              (recorded) => [recorded.datasetVersion, recorded.dataset] as const,
            ),
          ),
        );
        const bytes = provenanceBytes(
          publishedProvenance(assembled.values, datasets, assembled.numbering),
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
      await deps.db
        .withTenant(tenant, (trx) =>
          recordPublication(trx, {
            requestId: request.id,
            pipelineVersion: PIPELINE_VERSION[schema],
            // `compile` and `pinnedFacesByHash` re-hashed the faces against these very pins.
            fonts: PINNED_FONT_FILES.map(({ file, sha256 }) => ({ file, sha256 })),
            dataSha256: createHash('sha256').update(data).digest('hex'),
            numbering: assembled.numbering,
            // One per format the request names, the PDF first, or none: the record is whole or absent.
            outputs,
          }),
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
      await deps.db.withTenant(tenant, (trx) =>
        failPublicationRequest(trx, job.subjectId!, failures),
      );
    },
  };
}
