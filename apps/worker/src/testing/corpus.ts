import { createHash } from 'node:crypto';
import {
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseOutlineDocument,
  type AssembleInput,
  type Covers,
  type Layout,
  type PublishingAsset,
  type PublishingFormat,
  type ResolvedTheme,
} from '@alloy-works/domain';
import sharp from 'sharp';

// What the regression corpus (`regression.test.ts`) builds its documents from: the engine spike's
// seeded prose, ported from `spikes/publishing-engine/cases.py`, and the content model's shapes as a
// component and an outline store them. Pure builders; the suite assembles, compiles and reads.

/**
 * The spike's vocabulary, which leaves out every token a case plants (`mark07`, `row12`, `cellnote`)
 * and every table header's word, so that a search for one finds only it.
 */
const VOCABULARY = `
account action advice agreement amount analysis approach area argument aspect assessment
balance basis benefit budget capacity care case centre change choice claim clause committee
concern condition context contract control cost council course cover credit data decision
degree demand design detail development difference direction distance division effect effort
element energy estimate evidence example exchange experience extent factor feature figure focus
form framework function growth guidance impact income increase industry influence input interest
issue item knowledge labour language level limit line list loss management market material
matter meaning method model moment movement network number objective option order output
pattern payment period phase picture place plan point policy position practice pressure price
principle priority problem procedure process product programme project property proportion
purpose quality quantity range rate reason record region relation report request requirement
resource response result return review risk role rule sample scale scheme section sector sense
series service share side signal size source space stage standard statement step strategy
structure study subject supply support surface system target task term test theory threshold
time total trade trend unit use value version view volume weight whole work
`
  .trim()
  .split(/\s+/);
const LINKS = ['and', 'with', 'for', 'across', 'within', 'under', 'against', 'beyond', 'through'];
const VERBS = [
  'shows',
  'reflects',
  'supports',
  'limits',
  'shapes',
  'follows',
  'affects',
  'confirms',
  'extends',
  'reduces',
  'defines',
  'records',
  'meets',
  'exceeds',
  'tracks',
  'informs',
];

/**
 * Seeded, deterministic, plausible-shaped prose: the spike's `Text`, on mulberry32 rather than
 * Python's generator, so the words differ from the spike's and the shapes do not. The same seed gives
 * the same words on every run and every machine.
 */
export class Prose {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0;
  }

  /** The next number in [0, 1). */
  #next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A whole number from `low` to `high`, both included. */
  between(low: number, high: number): number {
    return low + Math.floor(this.#next() * (high - low + 1));
  }

  choice<T>(from: readonly T[]): T {
    return from[Math.floor(this.#next() * from.length)]!;
  }

  sentence(low = 12, high = 22): string {
    const count = this.between(low, high);
    const words: string[] = [];
    for (let at = 0; at < count; at += 1) {
      if (at > 0 && at % 5 === 2) words.push(this.choice(VERBS));
      else if (at > 0 && at % 5 === 4) words.push(this.choice(LINKS));
      else words.push(this.choice(VOCABULARY));
    }
    words[0] = words[0]!.charAt(0).toUpperCase() + words[0]!.slice(1);
    return `${words.join(' ')}.`;
  }

  words(count: number): string {
    return Array.from({ length: count }, () => this.choice(VOCABULARY)).join(' ');
  }

  /** A few words, the first capitalised, as a title. */
  title(count: number): string {
    const words = this.words(count);
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  paragraph(sentences: number): string {
    return Array.from({ length: sentences }, () => this.sentence()).join(' ');
  }
}

/**
 * An outline node's identifier from a name of letters: padded to the 26 characters the model holds
 * with a digit no name here uses, so `seca` and `secaa` stay two nodes.
 */
export const nodeId = (name: string): string => {
  if (!/^[a-z]{1,25}$/.test(name)) throw new Error(`Not a node name of letters: ${name}`);
  return name.padEnd(26, '7');
};

/** A whole number as letters, a to z then ba, bb: what a node's name can hold where a count is wanted. */
export const lettered = (value: number): string => {
  let rest = value;
  let out = '';
  do {
    out = String.fromCharCode(97 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  } while (rest > 0);
  return out;
};

/** A component's identifier, from a number. */
export const componentId = (value: number): string =>
  `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;

export const text = (value: string, ...marks: object[]) => ({ type: 'text', value, marks });
export const para = (id: string, ...content: unknown[]) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content,
});
/** A footnote anchored where it stands, holding these paragraphs. */
export const footnote = (id: string, ...paragraphs: unknown[]) => ({
  type: 'footnote',
  id,
  anchor: { kind: 'span' },
  content: paragraphs,
});
export const cell = (id: string, ...content: unknown[]) => ({
  content: [para(id, ...content)],
  colspan: 1,
  rowspan: 1,
});
/** A table of one header row over these rows, each cell a paragraph of these runs. */
export const table = (
  id: string,
  caption: readonly unknown[],
  header: readonly string[],
  rows: readonly (readonly (readonly unknown[])[])[],
) => ({
  type: 'table',
  id,
  style: 'table',
  caption,
  headerRows: 1,
  headerColumns: 0,
  rows: [
    { cells: header.map((word, column) => cell(`${id}h${column}`, text(word))) },
    ...rows.map((row, at) => ({
      cells: row.map((runs, column) => cell(`${id}r${at}c${column}`, ...runs)),
    })),
  ],
});
export const figure = (
  id: string,
  asset: string,
  alternative: string,
  caption: readonly unknown[],
) => ({
  type: 'figure',
  id,
  asset,
  imageStyle: 'figure',
  caption,
  alternative: { kind: 'own', text: alternative },
});
export const unorderedList = (id: string, items: readonly string[]) => ({
  type: 'list',
  id,
  kind: 'unordered',
  items: items.map((words, at) => ({ content: [para(`${id}i${at}`, text(words))] })),
});

const positional = { numbered: true, matter: 'body', pageBreak: 'none', values: {} } as const;

/** A section, titled by these runs or words, holding these nodes. */
export const section = (
  name: string,
  title: string | readonly unknown[],
  children: readonly unknown[] = [],
  over: object = {},
) => ({
  type: 'section',
  id: nodeId(name),
  title: typeof title === 'string' ? [text(title)] : title,
  ...positional,
  children,
  ...over,
});

/** One component placed in the outline, and what it holds: the heading it sets is its title. */
export interface Placed {
  readonly name: string;
  readonly component: string;
  readonly title: string;
  readonly content: readonly unknown[];
  readonly language?: string;
  readonly over?: object;
}

export const reference = (placed: Placed) => ({
  type: 'reference',
  id: nodeId(placed.name),
  component: placed.component,
  mode: { kind: 'latest' },
  ...positional,
  children: [],
  ...placed.over,
});

/** Every component placed anywhere in these outline nodes. */
export type Outlined = { readonly node: unknown; readonly placed: readonly Placed[] };

/** A reference to a component, and the component it places. */
export const placing = (placed: Placed): Outlined => ({
  node: reference(placed),
  placed: [placed],
});

/** A section holding these, and every component they place. */
export const inSection = (
  name: string,
  title: string | readonly unknown[],
  children: readonly Outlined[],
  over: object = {},
): Outlined => ({
  node: section(
    name,
    title,
    children.map((each) => each.node),
    over,
  ),
  placed: children.flatMap((each) => each.placed),
});

/** What a request would hand `assemble` for these nodes, under the default layout unless another. */
export function documentOf(options: {
  readonly title: string;
  readonly nodes: readonly Outlined[];
  readonly theme: ResolvedTheme;
  readonly covers: Covers;
  readonly layout?: Layout;
  readonly language?: string;
  readonly formats?: readonly [PublishingFormat, ...PublishingFormat[]];
  readonly assets?: ReadonlyMap<string, PublishingAsset>;
}): AssembleInput & { readonly layout: Layout } {
  const language = options.language ?? 'en-GB';
  return {
    formats: options.formats ?? ['pdf'],
    outline: parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: options.title,
      language,
      direction: 'ltr',
      nodes: options.nodes.map((each) => each.node),
    }),
    occurrences: new Map(
      options.nodes
        .flatMap((each) => each.placed)
        .map((placed) => [
          nodeId(placed.name),
          parseContentDocument({
            schemaVersion: 1,
            title: placed.title,
            language: placed.language ?? language,
            direction: 'ltr',
            content: placed.content,
          }),
        ]),
    ),
    refused: [],
    layout: options.layout ?? defaultLayout,
    theme: options.theme,
    revision: '0.1',
    covers: options.covers,
    assets: options.assets ?? new Map(),
  };
}

/**
 * An image made here - the spike's bar chart, as five bars of a colour on a pale ground - with the
 * facts a request hands the job for it, and its bytes, which the job would read from the store.
 */
export async function chartOf(version: string): Promise<{
  readonly version: string;
  readonly asset: PublishingAsset;
  readonly bytes: Buffer;
}> {
  const [width, height] = [240, 140];
  const bars = [0.35, 0.8, 0.55, 0.95, 0.6];
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const bar = Math.floor((x * bars.length) / width);
      const inset = x % Math.floor(width / bars.length) > 6;
      const on = inset && height - y < bars[bar]! * (height - 10);
      pixels.set(on ? [40, 70, 120] : [245, 245, 240], (y * width + x) * 3);
    }
  }
  const bytes = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
  const hash = createHash('sha256').update(bytes).digest('hex');
  return {
    version,
    bytes,
    asset: { object: `t_acme/sha256/${hash}`, format: 'png', width, height, alternative: null },
  };
}
