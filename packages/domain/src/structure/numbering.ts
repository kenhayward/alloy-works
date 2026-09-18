import type { InlineNode } from '../content/model/inline.js';

import { inlineContributions, type Contribution } from './contributions.js';
import { formatCounter, formatParts, type NumberingRule, type NumberingScheme } from './scheme.js';

/**
 * What numbering reads of a node, so that a stored outline and a reader's view (whose withheld
 * references carry `component: null`) number alike: numbering never reads which component a
 * reference names, only which occurrence it is.
 */
export interface NumberableNode {
  readonly type: 'section' | 'reference';
  readonly id: string;
  readonly numbered: boolean;
  readonly matter: 'body' | 'appendix';
  readonly title?: readonly InlineNode[];
  readonly children: readonly NumberableNode[];
}

export interface NumberableOutline {
  readonly nodes: readonly NumberableNode[];
}

/**
 * The first stage's answer (structure.md, "The order of the four stages"): the outline, and what each
 * occurrence it could resolve contributes, keyed by the occurrence's node - never by the component,
 * because one component placed twice is two occurrences (STR-010, STR-021). **An occurrence with no
 * entry is not known to whoever is numbering**: a component they may not read, one whose mode is
 * `approved` and so resolves to nothing yet, or one whose content does not read.
 */
export interface Resolved {
  readonly stage: 'resolved';
  readonly outline: NumberableOutline;
  readonly contributions: ReadonlyMap<string, readonly Contribution[]>;
}

/** The second stage's answer: what survives condition evaluation (STR-020, REU's, T4). */
export interface Conditioned {
  readonly stage: 'conditioned';
  readonly resolved: Resolved;
}

export function resolve(
  outline: NumberableOutline,
  contributions: ReadonlyMap<string, readonly Contribution[]>,
): Resolved {
  return { stage: 'resolved', outline, contributions };
}

/**
 * Condition evaluation, which is REU's and T4: the identity until then. It is a stage of its own now
 * so that `number` cannot be handed anything that has not been through it (STR-051) - a `Resolved`
 * does not typecheck where a `Conditioned` is wanted.
 */
export function conditions(resolved: Resolved): Conditioned {
  return { stage: 'conditioned', resolved };
}

/**
 * One numbered thing, and everything that produced it (STR-022): the node, the block or footnote
 * where it is one, the sequence and the matter, the section counter stack at that point, this
 * sequence's own counter, and the node whose entry last restarted that counter - so "why is this
 * Figure 7?" is answered by reading the entry, not by guessing. The rule applied is named by the
 * table's `scheme` with the entry's `sequence` and `matter`, rather than copied into every entry.
 *
 * `value`, `number` and `label` are `null` where the counter is not known to whoever is numbering:
 * an occurrence before it in the same counter's scope could not be read, so the number it would print
 * cannot be computed without a guess. A section's never is - a section number depends on the outline
 * alone.
 */
export interface NumberingEntry {
  readonly node: string;
  readonly block: string | null;
  readonly sequence: string;
  readonly matter: 'body' | 'appendix';
  readonly sections: readonly number[];
  readonly value: number | null;
  readonly restartedAt: string | null;
  readonly number: string | null;
  readonly label: string | null;
}

export interface NumberingTable {
  /** The scheme it was numbered against, by its `id`. */
  readonly scheme: string;
  readonly entries: readonly NumberingEntry[];
}

interface Counter {
  value: number;
  restartedAt: string | null;
  /** False from an occurrence nobody here can read until the counter next restarts. */
  known: boolean;
}

interface MatterState {
  /** The section counter stack: `sections[d - 1]` is the counter at depth `d`. */
  sections: number[];
  readonly counters: Map<string, Counter>;
}

const labelled = (rule: NumberingRule, written: string) =>
  rule.label === '' ? written : `${rule.label} ${written}`;

/**
 * **The one numbering function** (structure.md, "Numbering"), called by the service for a document's
 * numbering and by the outline panel for its section numbers - so the two cannot disagree, not by
 * agreement but by being one function (STR-036). Pure (STR-018): no clock, no randomness, and no
 * order but the tree's.
 *
 * The walk is depth-first in document order, and each matter keeps a counter stack of its own - an
 * appendix numbers in its own scheme (STR-016), and a body node after an appendix carries on the body's
 * numbering. For each node:
 *
 * 1. **Its section number**, if it and every ancestor is numbered. A node with `numbered: false` takes
 *    none and consumes none (STR-017), and neither does anything beneath it: a number formed from an
 *    ancestor that has none would be a guess. Taking one restarts every other sequence whose `restartAt`
 *    is at or below its depth (STR-015). A reference is a heading in the outline and takes one too.
 * 2. **Its title's footnotes**, for a section - a title is inline content, and may hold one.
 * 3. **Its occurrence's contributions**, for a reference: each caption-bearing block and footnote in
 *    document order takes the next number in its sequence (STR-023) - and an unnumbered equation takes
 *    none (CNT-047). An occurrence not known here makes every other counter in its matter unknown until
 *    it next restarts, **whether or not it holds anything**, so which counters go unknown says nothing
 *    about what the occurrence contains.
 * 4. **Its children.** An unnumbered node is transparent: what it holds carries on the counters of the
 *    numbered node before it.
 */
export function number(conditioned: Conditioned, scheme: NumberingScheme): NumberingTable {
  const { outline, contributions } = conditioned.resolved;
  const others = Object.keys(scheme.sequences).filter((name) => name !== 'section');
  const states: Record<'body' | 'appendix', MatterState> = {
    body: { sections: [], counters: new Map() },
    appendix: { sections: [], counters: new Map() },
  };
  const entries: NumberingEntry[] = [];

  const counterOf = (state: MatterState, sequence: string): Counter => {
    let counter = state.counters.get(sequence);
    if (counter === undefined) {
      counter = { value: 0, restartedAt: null, known: true };
      state.counters.set(sequence, counter);
    }
    return counter;
  };

  const take = (node: string, contribution: Contribution, matter: 'body' | 'appendix') => {
    const rule = scheme.sequences[contribution.sequence]?.[matter];
    const sectionRule = scheme.sequences['section']?.[matter];
    // A sequence the scheme does not declare numbers nothing, and an unnumbered equation takes no
    // number (CNT-047): neither is an entry, and neither moves a counter.
    if (rule === undefined || sectionRule === undefined || !contribution.numbered) return;
    const state = states[matter];
    const counter = counterOf(state, contribution.sequence);
    counter.value += 1;
    let written: string | null = null;
    if (counter.known) {
      const prefix =
        rule.prefix === null
          ? []
          : Array.from({ length: rule.prefix }, (_, index) => state.sections[index] ?? 0);
      const hasChapter = prefix.some((part) => part > 0);
      const own = formatCounter(counter.value, rule.format[rule.format.length - 1] ?? 'decimal');
      if (rule.prefix !== null && hasChapter) {
        written = `${formatParts(prefix, sectionRule).join(sectionRule.separator)}${rule.separator}${own}`;
      } else if (rule.prefix === null || matter !== 'appendix') {
        written = own;
      }
      // else: this rule wants a chapter prefix, but no numbered appendix has begun one yet
      // (`matter === 'appendix'` and `!hasChapter`) - there is no count to continue, and a bare
      // number here would repeat a body caption's own label, so it takes none.
    }
    entries.push({
      node,
      block: contribution.block,
      sequence: contribution.sequence,
      matter,
      sections: [...state.sections],
      // Tied to `written`, not just `counter.known`: a chapter-hungry appendix rule with no
      // chapter yet is known but still unprintable, and its value is withheld along with it.
      value: written === null ? null : counter.value,
      restartedAt: counter.restartedAt,
      number: written,
      label: written === null ? null : labelled(rule, written),
    });
  };

  const visit = (
    node: NumberableNode,
    depth: number,
    matter: 'body' | 'appendix',
    parent: string | null,
    numberedAbove: boolean,
  ) => {
    const state = states[matter];
    const takesNumber = numberedAbove && node.numbered;
    const sectionRule = scheme.sequences['section']?.[matter];
    if (takesNumber && sectionRule !== undefined) {
      state.sections = state.sections.slice(0, depth);
      state.sections[depth - 1] = (state.sections[depth - 1] ?? 0) + 1;
      state.sections.length = depth;
      const written = formatParts(state.sections, sectionRule).join(sectionRule.separator);
      entries.push({
        node: node.id,
        block: null,
        sequence: 'section',
        matter,
        sections: [...state.sections],
        value: state.sections[depth - 1] ?? null,
        restartedAt: parent,
        number: written,
        label: labelled(sectionRule, written),
      });
      for (const sequence of others) {
        const rule = scheme.sequences[sequence]?.[matter];
        if (rule?.restartAt != null && depth <= rule.restartAt) {
          state.counters.set(sequence, { value: 0, restartedAt: node.id, known: true });
        }
      }
    }
    if (node.type === 'section') {
      for (const footnote of inlineContributions(node.title ?? [])) take(node.id, footnote, matter);
    } else {
      const known = contributions.get(node.id);
      if (known === undefined) {
        for (const sequence of others) counterOf(state, sequence).known = false;
      } else {
        for (const contribution of known) take(node.id, contribution, matter);
      }
    }
    for (const child of node.children) {
      visit(child, depth + 1, matter, takesNumber ? node.id : parent, takesNumber);
    }
  };

  for (const node of outline.nodes) visit(node, 1, node.matter, null, true);
  return { scheme: scheme.id, entries };
}

/** Each numbered node's section number, for a panel that shows nothing else. */
export function sectionNumbers(table: NumberingTable): ReadonlyMap<string, string> {
  return new Map(
    table.entries.flatMap((entry) =>
      entry.sequence === 'section' && entry.number !== null ? [[entry.node, entry.number]] : [],
    ),
  );
}
