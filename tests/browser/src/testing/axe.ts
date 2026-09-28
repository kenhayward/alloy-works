import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from 'playwright-core';
import type { TaskMeta } from 'vitest';

/**
 * WCAG 2.2 AA's automatable criteria, as axe tags them (the W13 plan's B-I): A and AA at 2.0, 2.1 and
 * 2.2. `best-practice` is not WCAG, and is not asked for.
 */
export const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

/** One violation axe found: its rule, the element it found it on, and in which state of the page. */
export interface Found {
  readonly state: string;
  readonly rule: string;
  readonly target: string;
}

/**
 * The violations that need a design, each filed as an issue and held here until it is fixed (B-I).
 * Compared exactly: a violation not listed fails, and a listed one axe no longer finds fails too, until
 * it is taken off. Empty: CNT-078 cannot be attested while it holds anything. W13.2's first run found
 * five violations and fixed each, so nothing was held here. A target axe names by a CSS module's class
 * carries the stylesheet's hash and line in the name, so an entry is copied from the failure again
 * whenever its stylesheet changes.
 */
export const ALLOWED: readonly Allowed[] = [];

/** A violation held on the allow-list: where axe finds it, and the issue that says what it does to a person. */
export type Allowed = Found & { readonly issue: number };

declare module 'vitest' {
  interface TaskMeta {
    /** axe's version and, per state checked, what it could not decide and handed to a person (B-I). */
    axe?: { engine: string; incomplete: Record<string, readonly Found[]> };
  }
}

/** The pinned axe-core itself, injected by source, so the engine is the one this workspace names. */
const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);

/**
 * axe over the page, or the part of it `within` selects, in one named state: the violations compared
 * with the allow-list, and what axe marks `incomplete` - needing a person - written into the test's
 * `meta` for the audit (CNT-177), never failed on. `allowed` is the list's own tests' to give; every
 * other caller compares with `ALLOWED`.
 */
export async function checkAxe(
  page: Page,
  state: string,
  meta: TaskMeta,
  {
    within,
    allowed: list = ALLOWED,
  }: { readonly within?: string; readonly allowed?: readonly Allowed[] } = {},
): Promise<void> {
  let builder = new AxeBuilder({ page, axeSource: AXE_SOURCE }).withTags([...WCAG_22_AA]);
  if (within !== undefined) builder = builder.include(within);
  const results = await builder.analyze();
  const each = (found: typeof results.violations): Found[] =>
    found.flatMap((result) =>
      result.nodes.map((node) => ({ state, rule: result.id, target: node.target.join(' ') })),
    );

  meta.axe ??= { engine: results.testEngine.version, incomplete: {} };
  meta.axe.incomplete[state] = each(results.incomplete);

  const key = (found: Found) => `${found.rule} at ${found.target}`;
  const violations = each(results.violations).map(key).sort();
  const allowed = list
    .filter((entry) => entry.state === state)
    .map(key)
    .sort();
  if (JSON.stringify(violations) !== JSON.stringify(allowed)) {
    const unexpected = violations.filter((found) => !allowed.includes(found));
    const gone = allowed.filter((entry) => !violations.includes(entry));
    // What axe said of each element, so a failure names the colours or the size it measured and the
    // element's own markup, rather than only a selector a person has to go and find.
    const detail = results.violations
      .map(
        (result) =>
          `${result.id}: ${result.help} (${result.nodes.length})\n` +
          result.nodes
            .map(
              (node) =>
                `  at ${node.target.join(' ')}: ${node.html}\n` +
                `    ${(node.failureSummary ?? '').replace(/\s*\n\s*/g, ' ')}`,
            )
            .join('\n'),
      )
      .join('\n');
    throw new Error(
      `axe, in ${state}:\n` +
        (unexpected.length > 0
          ? `violations not on the allow-list:\n${unexpected.join('\n')}\n`
          : '') +
        (gone.length > 0
          ? `allowed, and no longer found - take them off:\n${gone.join('\n')}\n`
          : '') +
        detail,
    );
  }
}
