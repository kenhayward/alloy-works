import { z } from 'zod';
import { admit } from '../content/admission/admit.js';
import type { Receiver } from '../content/admission/reidentify.js';
import { createReport, type ReportEntry } from '../content/admission/report.js';
import type { BlockNode } from '../content/model/blocks.js';
import { CURRENT_SCHEMA_VERSION, parseContentDocument } from '../content/model/document.js';
import {
  changeOf,
  changesOf,
  identified,
  insertedBy,
  nodesIn,
  settled,
  threadsOf,
  type ProposedChange,
  type ProposedThread,
} from './changes.js';
import type { ImportChangeMark, ImportComment } from './structure.js';

/**
 * The heading levels an import breaks out at (the IM plan, IM-D): a section per heading at `section`
 * or above, a component per heading below that down to `component`, deeper headings inside it.
 */
export const importLevelsSchema = z
  .strictObject({
    section: z.int().min(1).max(8),
    component: z.int().min(2).max(9),
  })
  .refine((levels) => levels.component > levels.section, {
    message: 'A component heading is below its section heading',
  });

export type ImportLevels = z.infer<typeof importLevelsSchema>;

/** Ken's levels (IM-D): Heading 1 a section, Heading 2 a component. */
export const DEFAULT_IMPORT_LEVELS: ImportLevels = { section: 1, component: 2 };

/**
 * What a reader read, in order: a heading by its level, the style that made it one and its text; or a
 * block, a candidate in the pipeline's vocabulary (`admit`'s), with its text as the source showed it.
 */
export type ImportFlowItem =
  | {
      readonly kind: 'heading';
      readonly level: number;
      readonly style: string;
      readonly text: string;
      /** The reader's identifier for it, where a reference or a comment names it. */
      readonly anchor?: string;
    }
  | { readonly kind: 'block'; readonly block: unknown; readonly source: string };

/** Why a part starts where it does (IMP-004, IMP-030): the heading, by its style and text, or none. */
export type ImportPartReason =
  | {
      readonly rule: 'heading' | 'beforeFirstComponent';
      readonly style: string;
      readonly text: string;
      readonly level: number;
    }
  | { readonly rule: 'beforeFirstHeading' };

/**
 * What a person reviewing a part should look at: nothing in it, what it held refused whole, a change
 * kept here that ran on into the next part, a comment anchored here short of its range (IM-G).
 */
export type ImportPartFlag = 'empty' | 'refused' | 'changeClamped' | 'commentClamped';

export type ProposedPart = {
  readonly kind: 'section' | 'component';
  readonly title: string;
  /** A component's blocks, admitted; a section's none. */
  readonly blocks: readonly BlockNode[];
  /** Its text as the source had it, its heading first, for review beside the part (IMP-028). */
  readonly source: string;
  readonly reason: ImportPartReason;
  readonly flags: readonly ImportPartFlag[];
  /** The section part it stands under, by its place in the proposal; null at the top. */
  readonly parent: number | null;
  /** What admitting it kept differently or left out (IMP-007). */
  readonly report: readonly ReportEntry[];
  /** The reader's identifiers of the headings it stands for, which a reference may name. */
  readonly headings: readonly string[];
  readonly changes: readonly ProposedChange[];
  readonly threads: readonly ProposedThread[];
};

/** A part's source, held to what review shows beside it. */
export const IMPORT_SOURCE_MOST = 20_000;

/** The title of what stands before the first heading. */
export const INTRODUCTION_TITLE = 'Introduction';

type Open = {
  kind: 'section' | 'component';
  title: string;
  reason: ImportPartReason;
  parent: number | null;
  blocks: unknown[];
  source: string[];
  headings: number;
  anchors: string[];
};

/**
 * A proposal from what a reader read (IM-D): broken out at the levels given, each part with its
 * reason, and each component's blocks admitted as a paste is (CNT-130, IMP-017), so nothing proposed
 * can fail validation. A component whose blocks admission refuses is proposed empty and flagged.
 * Its blocks are its text with every tracked change rejected; each Word author's changes are kept
 * beside them, and each comment starting in it as a thread (IM-G).
 */
export function proposeImport(
  flow: readonly ImportFlowItem[],
  levels: ImportLevels,
  options: {
    readonly language: string;
    readonly direction: 'ltr' | 'rtl';
    readonly newIdentifier: () => string;
    /** The file's comments, each proposed as a thread in the part it starts in. */
    readonly comments?: readonly ImportComment[];
  },
): {
  readonly parts: readonly ProposedPart[];
  /** Where each block or footnote the reader identified was admitted, by the reader's identifier. */
  readonly anchors: Readonly<Record<string, string>>;
} {
  const open: Open[] = [];
  let section: number | null = null;
  let component: Open | undefined;

  for (const item of flow) {
    if (item.kind === 'heading' && item.level <= levels.component) {
      const reason = { style: item.style, text: item.text, level: item.level };
      const anchors = item.anchor === undefined ? [] : [item.anchor];
      if (item.level <= levels.section) {
        open.push({
          kind: 'section',
          title: item.text,
          reason: { rule: 'heading', ...reason },
          parent: null,
          blocks: [],
          source: [item.text],
          headings: 0,
          anchors,
        });
        section = open.length - 1;
        component = undefined;
      } else {
        component = {
          kind: 'component',
          title: item.text,
          reason: { rule: 'heading', ...reason },
          parent: section,
          blocks: [],
          source: [item.text],
          headings: 0,
          anchors,
        };
        open.push(component);
      }
      continue;
    }
    if (!component) {
      // Content before any component heading: the introduction, or its section's own opening.
      const owner = section === null ? undefined : open[section]!;
      component = {
        kind: 'component',
        title: owner?.title ?? INTRODUCTION_TITLE,
        reason:
          owner && owner.reason.rule !== 'beforeFirstHeading'
            ? { ...owner.reason, rule: 'beforeFirstComponent' }
            : { rule: 'beforeFirstHeading' },
        parent: section,
        blocks: [],
        source: [],
        headings: 0,
        anchors: [],
      };
      open.push(component);
    }
    if (item.kind === 'heading') {
      // Deeper than a component: kept in it as a paragraph, and said.
      component.blocks.push({
        type: 'paragraph',
        ...(item.anchor === undefined ? {} : { id: item.anchor }),
        content: [{ type: 'text', value: item.text, marks: [] }],
      });
      component.source.push(item.text);
      component.headings += 1;
    } else {
      component.blocks.push(item.block);
      component.source.push(item.source);
    }
  }

  // A change found in more than one part is kept in the first, and that part flagged (IM-G).
  const startsIn = new Map<string, number>();
  const crossed = new Set<number>();
  for (const [index, part] of open.entries()) {
    for (const node of nodesIn(part.blocks)) {
      const change = changeOf(node);
      if (change === undefined || change.id === '') continue;
      const key = `${change.author}\u{0}${change.id}`;
      const first = startsIn.get(key);
      if (first === undefined) startsIn.set(key, index);
      else if (first !== index) crossed.add(first);
    }
  }
  // A comment on a section's heading is on the component after it.
  const commentHeadings = open.map((part) => (part.kind === 'component' ? [...part.anchors] : []));
  for (const [index, part] of open.entries()) {
    if (part.kind !== 'section') continue;
    const after = open.findIndex((each, at) => at > index && each.kind === 'component');
    if (after !== -1) commentHeadings[after]!.push(...part.anchors);
  }
  const anchors: Record<string, string> = {};
  let provisional = 0;
  const next = () => `ip-${(provisional += 1)}`;
  const context = { language: options.language, direction: options.direction };

  const parts = open.map((part, index): ProposedPart => {
    const source = part.source.join('\n').slice(0, IMPORT_SOURCE_MOST);
    const base = {
      kind: part.kind,
      title: part.title,
      source,
      reason: part.reason,
      parent: part.parent,
      headings: part.anchors,
      changes: [],
      threads: [],
    };
    if (part.kind === 'section') return { ...base, blocks: [], flags: [], report: [] };
    if (part.blocks.length === 0) return { ...base, blocks: [], flags: ['empty'], report: [] };
    const read = createReport();
    if (part.headings > 0) read.add('read', 'rewritten', 'heading', { count: part.headings });
    const candidate = identified(part.blocks, next) as Record<string, unknown>[];
    const ours = (change: ImportChangeMark) =>
      change.id === '' || startsIn.get(`${change.author}\u{0}${change.id}`) === index;
    const receiver: Receiver = {
      document: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        title: part.title,
        ...context,
        content: [],
      },
      conditionAxes: [],
      newIdentifier: options.newIdentifier,
    };
    const admitted = admit(
      {
        candidate: {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          content: settled(
            candidate.filter((each) => insertedBy(each) === undefined),
            () => false,
          ),
        },
        report: read.entries,
      },
      receiver,
    );
    if (!admitted.ok) return { ...base, blocks: [], flags: ['refused'], report: admitted.report };
    for (const [from, to] of admitted.renamed) if (/^w[bf]-/.test(from)) anchors[from] = to;
    const report = createReport(admitted.report);
    const blocks = admitted.content;

    // Each author's changes, as the blocks they replace.
    const changes: ProposedChange[] = [];
    const authors = [
      ...new Set(
        [...nodesIn(candidate)].flatMap((node) => {
          const change = changeOf(node);
          return change && ours(change) ? [change.author] : [];
        }),
      ),
    ].sort();
    for (const author of authors) {
      const made = (change: ImportChangeMark) => change.author === author && ours(change);
      const variant = admit(
        {
          candidate: {
            schemaVersion: CURRENT_SCHEMA_VERSION,
            content: settled(
              candidate.filter((each) => {
                const by = insertedBy(each);
                return by === undefined || by === author;
              }),
              made,
            ),
          },
          report: [],
        },
        receiver,
      );
      const proposed = variant.ok ? changesOf(candidate, admitted, variant, author, made) : [];
      const content = blocks.flatMap((each) => {
        const change = proposed.find((one) => one.block === each.id);
        return change ? change.proposed : [each];
      });
      if (!variant.ok || proposed.length === 0 || !valid(content, part.title, context)) {
        report.add('read', 'discarded', 'trackedChange', { detail: author, count: 1 });
        continue;
      }
      changes.push(...proposed);
    }

    const threads = threadsOf(
      options.comments ?? [],
      {
        headings: commentHeadings[index]!,
        document: {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          title: part.title,
          ...context,
          content: [...blocks],
        },
      },
      admitted,
    );
    const flags: ImportPartFlag[] = [
      ...(crossed.has(index) && changes.length > 0 ? (['changeClamped'] as const) : []),
      ...(threads.some((each) => each.clamped) ? (['commentClamped'] as const) : []),
    ];
    return { ...base, blocks, flags, report: report.entries, changes, threads };
  });
  return { parts, anchors };
}

/** Whether blocks are a component's content (CNT-013). */
function valid(
  content: readonly BlockNode[],
  title: string,
  context: { readonly language: string; readonly direction: 'ltr' | 'rtl' },
): boolean {
  try {
    parseContentDocument({ schemaVersion: CURRENT_SCHEMA_VERSION, title, ...context, content });
    return true;
  } catch {
    return false;
  }
}
