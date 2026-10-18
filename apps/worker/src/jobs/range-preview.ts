import { createHash } from 'node:crypto';
import {
  failRangePreview,
  latestIteration,
  rangeInputs,
  rangePreviewOf,
  recordRangePages,
  type PublicationInputs,
  type TenantDatabase,
} from '@alloy-works/db';
import { parseContentDocument, type ContentDocument } from '@alloy-works/domain';
import type { ObjectStores, TenantStore } from '@alloy-works/objects';
import type { PinnedFonts } from '../fonts.js';
import { JobRefused } from '../refusal.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from '../template.js';
import type { RootImage } from '../typst.js';
import { startWarmCompile, type WarmCompile } from '../warm.js';
import type { JobHandler } from '../worker.js';
import { assembleRequest, PublishRefused, rootImages } from './publish.js';

/**
 * **The warm range preview's job** (CNT-186, PUB-080; publishing.md, "The warm range preview"; the R22
 * plan, R22-B): each refresh a range preview asks for, its request's recorded inputs assembled as a
 * preview's are - the author's latest iteration of the component being edited in place of its version -
 * and compiled warm. The document's warm compile is held in this worker between refreshes, drawing the
 * window's pages alone, so a save costs the edit's assembly, the layout it changes and a few pages.
 *
 * **The window** is the occurrence's pages and one either side, found when the range is first made: the
 * document compiled whole with the occurrence emptied and then as it is. Where it begins is the first
 * page of the last run of pages that differ (the contents, and any list of figures, change apart from
 * it, before it, where only their page numbers moved); how many pages it fills, how many the document
 * grows by. The window then stays where it was found: an edit that moves the occurrence far shows the
 * window's pages as they now fall, until the range is made again.
 */

/** A warm document held between refreshes: its compile, its inputs and the window it draws. */
interface Held {
  readonly warm: WarmCompile;
  readonly inputs: PublicationInputs;
  readonly store: TenantStore;
  readonly images: Set<string>;
  readonly window: { readonly from: number; readonly to: number };
  readonly pages: number;
  usedAt: number;
}

export interface WarmPool {
  /** The warm documents held, by range preview. */
  readonly held: Map<string, Held>;
  /** At most this many, the least recently used closed first: each holds its layout in memory. */
  readonly most: number;
  close(): Promise<void>;
}

export function createWarmPool(most = 4): WarmPool {
  const held = new Map<string, Held>();
  return {
    held,
    most,
    async close() {
      await Promise.all([...held.values()].map((each) => each.warm.close()));
      held.clear();
    },
  };
}

/**
 * Where an occurrence stands, from the document's pages compiled with it emptied and as it is: from the
 * page before the first of the last run of pages that differ, to the page after the pages it fills.
 */
export function windowOf(
  emptied: readonly string[],
  real: readonly string[],
): { readonly from: number; readonly to: number } {
  const differs: number[] = [];
  for (let page = 1; page <= real.length; page += 1) {
    if (emptied[page - 1] !== real[page - 1]) differs.push(page);
  }
  let start = differs.at(-1) ?? 1;
  for (let at = differs.length - 2; at >= 0 && differs[at] === start - 1; at -= 1) start -= 1;
  const fills = Math.max(1, real.length - emptied.length + 1);
  return {
    from: Math.max(1, start - 1),
    to: Math.min(real.length, start + fills),
  };
}

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function rangePreviewJob(deps: {
  readonly db: TenantDatabase;
  readonly stores: ObjectStores;
  readonly fonts: PinnedFonts;
  readonly binary: string;
  readonly pool: WarmPool;
  readonly conditionContent?: (node: string, content: ContentDocument) => ContentDocument;
}): JobHandler {
  /** The document's data, `content` in place of each occurrence of the component it edits. */
  const assembled = async (
    tenant: Parameters<JobHandler['run']>[0],
    inputs: PublicationInputs,
    store: TenantStore,
    component: string,
    content: ContentDocument | undefined,
  ) => {
    const nodes = placing(inputs.outline.nodes, component);
    const made = await assembleRequest(deps, inputs, store, tenant, {
      status: 'preview',
      ...(content === undefined
        ? {}
        : { content: (node: string) => (nodes.has(node) ? content : undefined) }),
    });
    if (!made.ok) throw new PublishRefused(made.failures);
    const placed = new Map(inputs.assets);
    for (const value of made.values) {
      if (!('image' in value)) continue;
      const bound = inputs.boundAssets.get(value.image.assetVersion);
      if (bound !== undefined) placed.set(value.image.assetVersion, bound);
    }
    return {
      data: JSON.stringify(made.document),
      template: PUBLICATION_TEMPLATE[TEMPLATE_READING[made.document.schema]].file,
      placed,
    };
  };

  /** Every page's hash, of a compile drawing them all. */
  const hashes = async (warm: WarmCompile, pages: number) => {
    const all: string[] = [];
    for (let page = 1; page <= pages; page += 1) all.push(sha(await warm.page(page)));
    return all;
  };

  /** The range made: the occurrence found, and a warm compile of its window held. */
  async function open(
    tenant: Parameters<JobHandler['run']>[0],
    id: string,
    requestId: string,
    node: string,
    component: string,
    content: ContentDocument | undefined,
  ): Promise<Held | undefined> {
    const inputs = await deps.db.withTenant(tenant, (trx) => rangeInputs(trx, requestId));
    if (!inputs) return undefined;
    const store = await deps.db.withTenant(tenant, (trx) => deps.stores.forTenant(trx, tenant));
    const recorded = inputs.occurrences.get(node)?.content;
    if (!recorded) throw new JobRefused('node_missing', 'The range names no occurrence.');
    // One empty paragraph in its place: a component holds a block at least.
    const empty = parseContentDocument({
      ...recorded,
      content: [{ type: 'paragraph', id: 'awrangeempty', style: 'body', content: [] }],
    });
    const without = await assembled(tenant, inputs, store, component, empty);
    const real = await assembled(tenant, inputs, store, component, content ?? recorded);
    const images = await rootImages(new Map([...without.placed, ...real.placed]), (key) =>
      store.get(key),
    );
    const whole = await startWarmCompile({
      binary: deps.binary,
      fonts: deps.fonts,
      template: without.template,
      data: without.data,
      createdAt: inputs.request.compiledAt,
      images,
    });
    let window: { from: number; to: number };
    let pages: number;
    try {
      const emptied = await hashes(whole.warm, whole.first.pages);
      const now = await whole.warm.update(real.data);
      pages = now.pages;
      window = windowOf(emptied, await hashes(whole.warm, now.pages));
    } finally {
      await whole.warm.close();
    }
    const started = await startWarmCompile({
      binary: deps.binary,
      fonts: deps.fonts,
      template: real.template,
      data: real.data,
      createdAt: inputs.request.compiledAt,
      images,
      pages: window,
    });
    const held: Held = {
      warm: started.warm,
      inputs,
      store,
      images: new Set(
        [...without.placed.values(), ...real.placed.values()].map((each) => each.object),
      ),
      window,
      pages,
      usedAt: Date.now(),
    };
    await admit(id, held);
    return held;
  }

  return {
    async run(tenant, job) {
      if (!job.subjectId) throw new JobRefused('no_subject', 'A range job must name a request.');
      const requestId = job.subjectId;
      const read = await deps.db.withTenant(tenant, async (trx) => {
        const range = await rangePreviewOf(trx, requestId);
        if (!range) return undefined;
        return { range, iteration: await latestIteration(trx, range) };
      });
      // Nothing to do: swept, or every refresh asked for already made.
      if (!read || read.range.made >= read.range.wanted) return;
      const { range, iteration } = read;
      const making = range.wanted;
      const content = iteration && parseContentDocument(iteration.content);

      let held = deps.pool.held.get(range.id);
      if (held) {
        const next = await assembled(tenant, held.inputs, held.store, range.componentId, content);
        await held.warm.update(next.data, await imagesFor(held, next.placed));
      } else {
        held = await open(tenant, range.id, requestId, range.node, range.componentId, content);
        if (!held) return;
      }
      held.usedAt = Date.now();
      const shown = held;
      const images: { page: number; png: Uint8Array }[] = [];
      for (let page = shown.window.from; page <= shown.window.to; page += 1) {
        images.push({ page, png: await shown.warm.page(page) });
      }
      await deps.db.withTenant(tenant, (trx) =>
        recordRangePages(trx, {
          id: range.id,
          made: making,
          sequence: iteration?.sequence ?? null,
          pages: shown.pages,
          range: shown.window,
          images,
        }),
      );
    },

    async failed(tenant, job, cause) {
      if (!job.subjectId) return;
      const code =
        cause instanceof JobRefused
          ? cause.code
          : cause instanceof PublishRefused
            ? 'refused'
            : 'failed';
      const range = await deps.db.withTenant(tenant, (trx) => rangePreviewOf(trx, job.subjectId!));
      if (range) {
        await deps.pool.held.get(range.id)?.warm.close();
        deps.pool.held.delete(range.id);
      }
      await deps.db.withTenant(tenant, (trx) => failRangePreview(trx, job.subjectId!, code));
    },
  };

  /** Held, closing the least recently used where the pool is full. */
  async function admit(id: string, held: Held) {
    while (deps.pool.held.size >= deps.pool.most) {
      const [oldest] = [...deps.pool.held.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt);
      if (!oldest) break;
      deps.pool.held.delete(oldest[0]);
      await oldest[1].warm.close();
    }
    deps.pool.held.set(id, held);
  }

  /** The images the data places that the warm root does not hold yet. */
  async function imagesFor(
    held: Held,
    placed: ReadonlyMap<string, { readonly object: string }>,
  ): Promise<RootImage[]> {
    const fresh = new Map([...placed].filter(([, asset]) => !held.images.has(asset.object)));
    if (fresh.size === 0) return [];
    const images = await rootImages(fresh as never, (key) => held.store.get(key));
    for (const asset of fresh.values()) held.images.add(asset.object);
    return images;
  }
}

/** The nodes of an outline placing a component: each occurrence the author's edit shows in. */
function placing(
  nodes: readonly {
    readonly id: string;
    readonly component?: string;
    readonly children?: readonly unknown[];
  }[],
  component: string,
  found = new Set<string>(),
): Set<string> {
  for (const node of nodes) {
    if (node.component === component) found.add(node.id);
    if (node.children) placing(node.children as typeof nodes, component, found);
  }
  return found;
}
