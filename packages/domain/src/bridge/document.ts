import type {
  DecomposedDocument,
  DecomposedImage,
  Equation,
  Inline,
} from '@kenhayward/bridge-contract';

import type { ContentDocument, InlineNode } from '../content/model/index.js';
import type { OutlineDocument } from '../structure/outline.js';

import {
  mapBlocks,
  mapTitle,
  type BlockContext,
  type CrossTarget,
  type DecomposedBlock,
  type DecomposedNote,
} from './blocks.js';
import { componentIdFor, elementIdFor } from './ids.js';
import { carry, type CarryEntry } from './report.js';

type Section = DecomposedDocument['sections'][number];
type OutlineNode = OutlineDocument['nodes'][number];

/** How many words of its first paragraph an untitled section is titled with. */
const TITLE_WORDS = 8;

/** The section key the lead component is named by (docs/design/ct-studio-sink.md, "Identifiers"). */
const LEAD = '~lead';

export type MappedComponent = {
  artifactId: string;
  /** The CT Studio section id, `~lead` for the lead component. */
  section: string;
  title: string;
  content: ContentDocument;
};

export type MappedDocument = {
  components: readonly MappedComponent[];
  /** The outline, each reference pinned to the version `pins` gives for its component. */
  outline(pins: ReadonlyMap<string, string>): OutlineDocument;
  carried: readonly CarryEntry[];
};

/** The words of decomposed inlines, a break a space. */
function wordsOf(inlines: readonly Inline[]): string {
  return inlines
    .map((inline) => {
      switch (inline.kind) {
        case 'text':
        case 'xref':
          return inline.text;
        case 'link':
          return wordsOf(inline.inlines);
        case 'break':
          return ' ';
        default:
          return '';
      }
    })
    .join('');
}

/** The text of mapped inlines: what a section title must have some of. */
function textOf(inlines: readonly InlineNode[]): string {
  return inlines.map((inline) => (inline.type === 'text' ? inline.value : '')).join('');
}

/** The first words of the first paragraph that has any. */
function firstWords(blocks: readonly DecomposedBlock[]): string | null {
  for (const block of blocks) {
    if (block.kind !== 'paragraph') continue;
    const words = wordsOf(block.inlines).split(/\s+/).filter(Boolean);
    if (words.length > 0) return words.slice(0, TITLE_WORDS).join(' ');
  }
  return null;
}

/** Every block a cross-reference may name, those inside a list item or a cell too. */
function blockIds(blocks: readonly DecomposedBlock[], into: string[]): string[] {
  for (const block of blocks) {
    into.push(block.id);
    if (block.kind === 'list') for (const item of block.items) blockIds(item.blocks, into);
    if (block.kind === 'table') {
      for (const row of block.rows) for (const cell of row.cells) blockIds(cell.blocks, into);
    }
  }
  return into;
}

/** The identifiers of the blocks a mapping made, in document order, those in lists and cells too. */
function madeIds(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const each of value) madeIds(each, into);
  } else if (typeof value === 'object' && value !== null) {
    const node = value as { type?: unknown; id?: unknown };
    if (typeof node.id === 'string' && BLOCK_TYPES.has(String(node.type))) into.push(node.id);
    for (const each of Object.values(value)) madeIds(each, into);
  }
  return into;
}

const BLOCK_TYPES: ReadonlySet<string> = new Set([
  'paragraph',
  'list',
  'table',
  'figure',
  'equation',
]);

type SectionShape = {
  id: string;
  title: InlineNode[];
  component: string | null;
  sections: SectionShape[];
};

/**
 * A decomposed document as one component per section's own text and an outline of the sections. Every
 * identifier is derived (ids.ts), so the same document mapped twice is the same; the outline waits for
 * the versions the components were written at.
 */
export function mapDocument(
  document: DecomposedDocument,
  input: { persistentId: string; title: string; assets: ReadonlyMap<string, string> },
): MappedDocument {
  const { persistentId } = input;
  const images: ReadonlyMap<string, DecomposedImage> = new Map(
    document.images.map((image) => [image.id, image]),
  );
  const equations: ReadonlyMap<string, Equation> = new Map(
    document.equations.map((equation) => [equation.id, equation]),
  );
  const notes: ReadonlyMap<string, DecomposedNote> = new Map(
    document.notes.map((note) => [note.id, note]),
  );

  const nodeIdOf = (section: string): string => elementIdFor(persistentId, section);

  // The lead and every section, in document order, with the blocks each holds of its own.
  const owned: { section: string; blocks: readonly DecomposedBlock[] }[] = [
    { section: LEAD, blocks: document.blocks },
  ];
  const nodeTargets = new Map<string, CrossTarget>();
  const collect = (sections: readonly Section[]): void => {
    for (const section of sections) {
      owned.push({ section: section.id, blocks: section.blocks });
      nodeTargets.set(section.id, { kind: 'node', node: nodeIdOf(section.id) });
      collect(section.sections);
    }
  };
  collect(document.sections);

  // Where each block lives, so a reference finds it in its own component or in another.
  const home = new Map<string, string>();
  for (const { section, blocks } of owned) {
    for (const id of blockIds(blocks, [])) home.set(id, section);
  }
  const contextFor = (owner: string, targets: ReadonlyMap<string, CrossTarget>): BlockContext => ({
    owner,
    assets: input.assets,
    targets,
    notes,
    images,
    equations,
  });

  // The blocks a mapping really makes, found by mapping each once: it drops a duplicate empty
  // paragraph, flattens a table in a cell and keeps the ids of the rest, and a reference must never
  // name an id that is not there.
  const made = new Set<string>();
  const firstOfLead: { block: string | null } = { block: null };
  const provisional = new Map(nodeTargets);
  for (const [id, at] of home) {
    const component = componentIdFor(persistentId, at);
    provisional.set(id, { kind: 'component', component, block: elementIdFor(component, id) });
  }
  for (const { section, blocks } of owned) {
    const owner = componentIdFor(persistentId, section);
    const ids = madeIds(mapBlocks(blocks, contextFor(owner, provisional)).blocks);
    for (const id of ids) made.add(id);
    if (section === LEAD) firstOfLead.block = ids[0] ?? null;
  }
  const targetsFor = (section: string): ReadonlyMap<string, CrossTarget> => {
    const targets = new Map(nodeTargets);
    for (const [id, at] of home) {
      const component = componentIdFor(persistentId, at);
      const block = elementIdFor(component, id);
      if (!made.has(block)) {
        // Dropped or flattened: its section's node, or for the lead, which has none, the lead's first block.
        const node = nodeTargets.get(at);
        if (node !== undefined) targets.set(id, node);
        else if (firstOfLead.block !== null) {
          targets.set(id, { kind: 'component', component, block: firstOfLead.block });
        }
      } else {
        targets.set(
          id,
          at === section ? { kind: 'block', block } : { kind: 'component', component, block },
        );
      }
    }
    return targets;
  };
  const carried: CarryEntry[] = [];
  const components: MappedComponent[] = [];

  const componentOf = (
    section: string,
    title: string,
    blocks: readonly DecomposedBlock[],
  ): string => {
    const artifactId = componentIdFor(persistentId, section);
    const mapped = mapBlocks(blocks, contextFor(artifactId, targetsFor(section)));
    carried.push(...mapped.carried);
    components.push({
      artifactId,
      section,
      title,
      content: {
        schemaVersion: 1,
        title,
        language: 'und',
        direction: 'ltr',
        content: mapped.blocks,
      },
    });
    return artifactId;
  };

  // A title stands under no component, so it can only point at a section.
  const titleContext = contextFor(persistentId, nodeTargets);
  let position = 0;
  const shapeOf = (section: Section): SectionShape => {
    position += 1;
    const mapped = mapTitle(section.title, titleContext, section.id);
    carried.push(...mapped.carried);
    let title = mapped.inlines;
    if (textOf(title).trim() === '') {
      const words = firstWords(section.blocks);
      carried.push(carry('title_from_text', section.id, words === null ? 'position' : 'words'));
      title = [{ type: 'text', value: words ?? `Section ${position}`, marks: [] }];
    }
    return {
      id: section.id,
      title,
      component:
        section.blocks.length > 0 ? componentOf(section.id, textOf(title), section.blocks) : null,
      sections: section.sections.map(shapeOf),
    };
  };

  const lead = document.blocks.length > 0 ? componentOf(LEAD, input.title, document.blocks) : null;
  const shapes = document.sections.map(shapeOf);

  const referenceTo = (
    key: string,
    component: string,
    pins: ReadonlyMap<string, string>,
  ): OutlineNode => {
    const version = pins.get(component);
    if (version === undefined) throw new Error(`No version is given for component ${component}`);
    return {
      type: 'reference',
      id: elementIdFor(persistentId, `${key}/component`),
      component,
      mode: { kind: 'pinned', version },
      numbered: false,
      matter: 'body',
      pageBreak: 'none',
      values: {},
      children: [],
    };
  };
  const nodeOf = (section: SectionShape, pins: ReadonlyMap<string, string>): OutlineNode => ({
    type: 'section',
    id: nodeIdOf(section.id),
    title: section.title,
    numbered: false,
    matter: 'body',
    pageBreak: 'none',
    values: {},
    children: [
      ...(section.component === null ? [] : [referenceTo(section.id, section.component, pins)]),
      ...section.sections.map((child) => nodeOf(child, pins)),
    ],
  });

  return {
    components,
    outline: (pins) => ({
      schemaVersion: 3,
      title: input.title,
      language: 'und',
      direction: 'ltr',
      nodes: [
        ...(lead === null ? [] : [referenceTo(LEAD, lead, pins)]),
        ...shapes.map((section) => nodeOf(section, pins)),
      ],
    }),
    carried,
  };
}
