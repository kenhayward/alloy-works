import { z } from 'zod';
import { admit } from '../content/admission/admit.js';
import { createReport, type ReportEntry } from '../content/admission/report.js';
import type { BlockNode } from '../content/model/blocks.js';
import { CURRENT_SCHEMA_VERSION } from '../content/model/document.js';

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

/** What a person reviewing a part should look at: nothing in it, or what it held refused whole. */
export type ImportPartFlag = 'empty' | 'refused';

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
};

/**
 * A proposal from what a reader read (IM-D): broken out at the levels given, each part with its
 * reason, and each component's blocks admitted as a paste is (CNT-130, IMP-017), so nothing proposed
 * can fail validation. A component whose blocks admission refuses is proposed empty and flagged.
 */
export function proposeImport(
  flow: readonly ImportFlowItem[],
  levels: ImportLevels,
  options: {
    readonly language: string;
    readonly direction: 'ltr' | 'rtl';
    readonly newIdentifier: () => string;
  },
): { readonly parts: readonly ProposedPart[] } {
  const open: Open[] = [];
  let section: number | null = null;
  let component: Open | undefined;

  for (const item of flow) {
    if (item.kind === 'heading' && item.level <= levels.component) {
      const reason = { style: item.style, text: item.text, level: item.level };
      if (item.level <= levels.section) {
        open.push({
          kind: 'section',
          title: item.text,
          reason: { rule: 'heading', ...reason },
          parent: null,
          blocks: [],
          source: [item.text],
          headings: 0,
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
      };
      open.push(component);
    }
    if (item.kind === 'heading') {
      // Deeper than a component: kept in it as a paragraph, and said.
      component.blocks.push({
        type: 'paragraph',
        content: [{ type: 'text', value: item.text, marks: [] }],
      });
      component.source.push(item.text);
      component.headings += 1;
    } else {
      component.blocks.push(item.block);
      component.source.push(item.source);
    }
  }

  return {
    parts: open.map((part): ProposedPart => {
      const source = part.source.join('\n').slice(0, IMPORT_SOURCE_MOST);
      const base = {
        kind: part.kind,
        title: part.title,
        source,
        reason: part.reason,
        parent: part.parent,
      };
      if (part.kind === 'section') return { ...base, blocks: [], flags: [], report: [] };
      if (part.blocks.length === 0) return { ...base, blocks: [], flags: ['empty'], report: [] };
      const read = createReport();
      if (part.headings > 0) read.add('read', 'rewritten', 'heading', { count: part.headings });
      const admitted = admit(
        {
          candidate: { schemaVersion: CURRENT_SCHEMA_VERSION, content: part.blocks },
          report: read.entries,
        },
        {
          document: {
            schemaVersion: CURRENT_SCHEMA_VERSION,
            title: part.title,
            language: options.language,
            direction: options.direction,
            content: [],
          },
          conditionAxes: [],
          newIdentifier: options.newIdentifier,
        },
      );
      return admitted.ok
        ? { ...base, blocks: admitted.content, flags: [], report: admitted.report }
        : { ...base, blocks: [], flags: ['refused'], report: admitted.report };
    }),
  };
}
