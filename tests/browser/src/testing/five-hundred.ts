import type { paths } from '@alloy-works/api-client';
import {
  edit,
  nodesOf,
  readDocument,
  titleOf,
  words,
  type Client,
  type DocumentView,
} from './api.js';
import { generalSpace, makeComponent } from './component.js';
import { blockEquation } from './every-block.js';

/**
 * The budgets' document (the W13 plan's W13.3, step 3): STR-063's reference shape, made through the
 * API. Five hundred nodes - ten chapters of nine sections each, a hundred sections in all, and four
 * hundred references to four hundred components, forty to a chapter, five under each of its first four
 * sections and four under each of the other five. Each component is a heading's worth of prose and a
 * list of three items, and every tenth holds a table and a numbered equation as well, so the view sets
 * what a document holds.
 *
 * **Made once per stack, and found after that** (B-C): nothing measured changes it but a move, which
 * the test that makes one puts back, and the shape it is checked against survives a move among
 * siblings left undone by a failed run. Its title carries the shape's version, so a change to the shape
 * below takes a new version and a new document.
 */
export const FIVE_HUNDRED = {
  version: 1,
  chapters: 10,
  sectionsPerChapter: 9,
  // References under each of a chapter's sections, in order: forty to a chapter.
  referencesPerSection: [5, 5, 5, 5, 4, 4, 4, 4, 4],
  components: 400,
  // Every tenth component holds a table and an equation.
  richEvery: 10,
} as const;

export const FIVE_HUNDRED_TITLE = `Five hundred nodes, fixture ${FIVE_HUNDRED.version}`;

/** What the fixture is, as read back from the service rather than assumed. */
export interface FiveHundred {
  readonly document: DocumentView;
  readonly nodes: number;
  readonly sections: number;
  readonly references: number;
  readonly components: number;
  /** The first reference in reading order, and words its text opens with. */
  readonly first: { readonly node: string; readonly words: string };
  /** Every node in reading order, with its depth. */
  readonly order: readonly { readonly id: string; readonly type: 'section' | 'reference' }[];
}

/** A small seeded generator (mulberry32), so every run of a sequence is the same run. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VOCABULARY = (
  'the a measure of each step is taken from sample record when after before value result ' +
  'process check setting within range under over holds reads written kept later first next ' +
  'system part line table unit load level rate test note change order point side part'
).split(' ');

/** The words component `n`'s text opens with: what the open waits to see in its first screen. */
export function opening(n: number): string {
  return `Component ${String(n).padStart(3, '0')} opens here`;
}

function text(value: string) {
  return { type: 'text', value, marks: [] };
}

function paragraph(id: string, value: string) {
  return { type: 'paragraph', id, style: 'body', content: [text(value)] };
}

function prose(random: () => number, count: number): string {
  const chosen = Array.from(
    { length: count },
    () => VOCABULARY[Math.floor(random() * VOCABULARY.length)]!,
  );
  return `${chosen.join(' ')}.`;
}

/** Component `n`'s content: prose and a list, and a table and an equation in every tenth. */
export function contentOf(n: number): readonly unknown[] {
  const random = seeded(n + 1);
  const blocks: unknown[] = [
    paragraph('p1', `${opening(n)}: ${prose(random, 70)}`),
    {
      type: 'list',
      id: 'l1',
      kind: 'unordered',
      items: [1, 2, 3].map((item) => ({ content: [paragraph(`l1i${item}`, prose(random, 8))] })),
    },
  ];
  if (n % FIVE_HUNDRED.richEvery === 0) {
    const cell = (id: string, value: string) => ({
      content: [paragraph(id, value)],
      colspan: 1,
      rowspan: 1,
    });
    blocks.push(
      {
        type: 'table',
        id: 't1',
        style: 'table',
        caption: [text(`Measures of component ${n}`)],
        headerRows: 1,
        headerColumns: 0,
        rows: [
          { cells: [cell('t1a', 'Measure'), cell('t1b', 'First'), cell('t1c', 'Second')] },
          { cells: [cell('t1d', 'Rate'), cell('t1e', '12'), cell('t1f', '14')] },
          { cells: [cell('t1g', 'Load'), cell('t1h', '3'), cell('t1i', '5')] },
        ],
      },
      blockEquation('e1'),
    );
  }
  return blocks;
}

type Listed =
  paths['/v1/documents']['get']['responses']['200']['content']['application/json']['items'][number];

/** Every document in the General space, a page at a time. */
async function everyDocument(client: Client, space: string): Promise<Listed[]> {
  const all: Listed[] = [];
  let cursor: string | undefined;
  for (;;) {
    const { data, response } = await client.GET('/v1/documents', {
      params: { query: { spaces: space, limit: '100', ...(cursor ? { cursor } : {}) } },
    });
    if (!data) throw new Error(`listing documents answered ${response.status}`);
    all.push(...data.items);
    if (!data.next) return all;
    cursor = data.next;
  }
}

/**
 * The fixture as the service holds it, if `document` has its shape: ten chapters of nine sections,
 * each section holding only references, as many as the shape says - in any order among siblings, so a
 * move a failed run left undone does not cost a new fixture - every one naming a component the caller
 * may read, four hundred in all and no two alike. Null where it has another shape.
 */
function readBack(document: DocumentView): FiveHundred | null {
  const chapters = nodesOf(document);
  if (chapters.length !== FIVE_HUNDRED.chapters) return null;
  const order: { id: string; type: 'section' | 'reference' }[] = [];
  const components = new Set<string>();
  let sections = 0;
  let references = 0;
  const wanted = [...FIVE_HUNDRED.referencesPerSection].sort().join();
  // A section as the fixture makes it: titled so, starting on no new page. A title or a Starts on a
  // failed run left changed is a document of another shape.
  const made = (node: (typeof chapters)[number], title: RegExp) =>
    node.type === 'section' && node.pageBreak === 'none' && title.test(titleOf(node));
  for (const chapter of chapters) {
    if (!made(chapter, /^Chapter \d+$/)) return null;
    if (chapter.children.length !== FIVE_HUNDRED.sectionsPerChapter) return null;
    sections += 1;
    order.push({ id: chapter.id, type: 'section' });
    const counts: number[] = [];
    for (const section of chapter.children) {
      if (!made(section, /^Topic \d+\.\d+$/)) return null;
      sections += 1;
      order.push({ id: section.id, type: 'section' });
      counts.push(section.children.length);
      for (const reference of section.children) {
        const component = (reference as { component?: string | null }).component;
        if (reference.type !== 'reference' || reference.children.length > 0 || !component) {
          return null;
        }
        references += 1;
        components.add(component);
        order.push({ id: reference.id, type: 'reference' });
      }
    }
    if (counts.sort().join() !== wanted) return null;
  }
  if (components.size !== FIVE_HUNDRED.components || references !== FIVE_HUNDRED.components) {
    return null;
  }
  const first = order.find((node) => node.type === 'reference')!;
  return {
    document,
    nodes: order.length,
    sections,
    references,
    components: components.size,
    first: { node: first.id, words: '' },
    order,
  };
}

/** Runs `work` over `items` with at most `width` at once. */
async function inPool<T>(
  items: readonly T[],
  width: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (next < items.length) await work(items[next++]!);
    }),
  );
}

/** The fixture made: its four hundred components, then its outline, one act at a time. */
async function make(client: Client, space: string): Promise<DocumentView> {
  const ids: string[] = new Array<string>(FIVE_HUNDRED.components);
  await inPool(
    Array.from({ length: FIVE_HUNDRED.components }, (_, n) => n),
    8,
    async (n) => {
      const made = await makeComponent(
        client,
        `${FIVE_HUNDRED_TITLE}, component ${String(n).padStart(3, '0')}`,
        contentOf(n),
      );
      ids[n] = made.id;
    },
  );
  const { data: made, response } = await client.POST('/v1/spaces/{space}/documents', {
    params: { path: { space } },
    body: { title: FIVE_HUNDRED_TITLE, language: 'en-GB', direction: 'ltr' },
  });
  if (!made) throw new Error(`making the fixture's document answered ${response.status}`);
  let document: DocumentView = made;
  let component = 0;
  for (let c = 0; c < FIVE_HUNDRED.chapters; c++) {
    document = await edit(client, document, {
      operation: 'insert',
      parent: null,
      position: c,
      node: { type: 'section', title: words(`Chapter ${c + 1}`) },
    });
    const chapter = nodesOf(document)[c]!.id;
    for (let s = 0; s < FIVE_HUNDRED.sectionsPerChapter; s++) {
      document = await edit(client, document, {
        operation: 'insert',
        parent: chapter,
        position: s,
        node: { type: 'section', title: words(`Topic ${c + 1}.${s + 1}`) },
      });
      const section = nodesOf(document)[c]!.children[s]!.id;
      for (let r = 0; r < FIVE_HUNDRED.referencesPerSection[s]!; r++) {
        document = await edit(client, document, {
          operation: 'insert',
          parent: section,
          position: r,
          node: { type: 'reference', component: ids[component++]!, mode: { kind: 'latest' } },
        });
      }
    }
  }
  return document;
}

/**
 * The fixture, found in the General space by its title and its shape, or made there (B-C). What is
 * answered is read back from the service, and the first reference's opening words are read from the
 * text the service holds for it, so nothing about the document is assumed.
 */
export async function fiveHundred(client: Client): Promise<FiveHundred> {
  const space = await generalSpace(client);
  let found: FiveHundred | null = null;
  const candidates = (await everyDocument(client, space)).filter(
    (each) =>
      each.title === FIVE_HUNDRED_TITLE &&
      each.components === FIVE_HUNDRED.components &&
      each.sections === FIVE_HUNDRED.chapters * (1 + FIVE_HUNDRED.sectionsPerChapter),
  );
  for (const candidate of candidates) {
    found = readBack(await readDocument(client, candidate.id));
    if (found !== null) break;
  }
  if (found === null) {
    found = readBack(await readDocument(client, (await make(client, space)).id));
    if (found === null) throw new Error('The fixture made does not read back in its own shape');
  }
  const { data: texts, response } = await client.GET('/v1/documents/{id}/texts', {
    params: { path: { id: found.document.id } },
  });
  if (!texts) throw new Error(`reading the fixture's texts answered ${response.status}`);
  const version = texts.occurrences.find((each) => each.node === found.first.node)?.version;
  const content = JSON.stringify(texts.versions.find((each) => each.id === version)?.content ?? '');
  const opens = /Component \d{3} opens here/.exec(content)?.[0];
  if (!opens)
    throw new Error("The fixture's first component does not open as the fixture writes it");
  return { ...found, first: { node: found.first.node, words: opens } };
}
