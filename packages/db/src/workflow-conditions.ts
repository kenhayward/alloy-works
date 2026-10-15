import {
  missingSections,
  readOutline,
  TRANSITION_CONDITIONS,
  walkOutline,
  type TransitionCondition,
  type WorkflowKind,
} from '@alloy-works/domain';
import { documentBindings, resolveOccurrences } from './publishing.js';
import { pendingCounts } from './suggestions.js';
import type { TenantTransaction } from './tables.js';
import { documentRules } from './templates.js';
import { latestVersion } from './versions.js';

/**
 * **What a transition requires** (workflow.md; the WF3 plan): the conditions a transition names,
 * checked as it is taken, a plain move or an approval at a gate. Counts, never content; names only
 * where the decider may read them.
 */

export interface UnmetCondition {
  readonly condition: TransitionCondition;
  /** How many stand in its way: suggestions, threads, bindings, sections, revisions or components. */
  readonly count: number;
  /** The sections missing and the components not approved, by title. */
  readonly names: readonly string[];
  /** Components the decider may not read, which leave it unproven (WF3-D). */
  readonly unreadable: number;
}

/** Threads still open on any of these (COL; WF3-C). */
async function openThreads(trx: TenantTransaction, on: readonly string[]): Promise<number> {
  if (on.length === 0) return 0;
  const row = await trx
    .selectFrom('thread as t')
    .leftJoin('thread_resolution as r', 'r.thread_id', 't.id')
    .select((eb) => eb.fn.countAll<string>().as('open'))
    .where('t.on_id', 'in', [...on])
    .where('r.thread_id', 'is', null)
    .executeTakeFirstOrThrow();
  return Number(row.open);
}

async function pendingSuggestions(
  trx: TenantTransaction,
  components: readonly string[],
): Promise<number> {
  let total = 0;
  for (const count of (await pendingCounts(trx, components)).values()) total += count;
  return total;
}

/** Each version's title, as its content holds it. */
async function titlesOf(
  trx: TenantTransaction,
  versions: readonly string[],
): Promise<Map<string, string>> {
  if (versions.length === 0) return new Map();
  const rows = await trx
    .selectFrom('artifact_version')
    .select([
      'id',
      (eb) =>
        eb
          .ref('content', '->>')
          .key('title' as never)
          .as('title'),
    ])
    .where('id', 'in', [...versions])
    .execute();
  return new Map(rows.map((row) => [row.id, String(row.title ?? '')]));
}

/**
 * The conditions of `requires` an artifact does not meet now, in the order the transition names them,
 * read as `principal`, the person taking it (WF3-B to WF3-E). Empty where every one is met.
 */
export async function unmetConditions(
  trx: TenantTransaction,
  input: {
    readonly artifactId: string;
    readonly kind: WorkflowKind;
    readonly requires: readonly TransitionCondition[];
    readonly principal: string;
  },
): Promise<UnmetCondition[]> {
  const requires = TRANSITION_CONDITIONS.filter((each) => input.requires.includes(each));
  if (requires.length === 0) return [];
  const found = new Map<TransitionCondition, Omit<UnmetCondition, 'condition'>>();
  const none = { count: 0, names: [], unreadable: 0 };

  if (input.kind !== 'document') {
    // A component's own; a query definition's transitions require nothing (WF3-A).
    if (requires.includes('suggestions')) {
      found.set('suggestions', {
        ...none,
        count: await pendingSuggestions(trx, [input.artifactId]),
      });
    }
    if (requires.includes('threads')) {
      found.set('threads', { ...none, count: await openThreads(trx, [input.artifactId]) });
    }
  } else {
    const latest = await latestVersion(trx, input.artifactId);
    if (!latest) return [];
    const read = readOutline(latest.content, { artifact: input.artifactId, version: latest.id });
    if (!read.ok) throw new Error(`The document ${input.artifactId} at ${latest.id} does not read`);
    const references = new Map<string, { component: string; approved: boolean }>();
    walkOutline(read.outline.nodes, (node) => {
      if (node.type === 'reference') {
        references.set(node.id, {
          component: node.component,
          approved: node.mode.kind === 'approved',
        });
      }
    });
    // Every component it assembles, read by the decider or not: counted, never shown (WF3-C).
    const components = [...new Set([...references.values()].map((each) => each.component))];
    if (requires.includes('suggestions')) {
      found.set('suggestions', { ...none, count: await pendingSuggestions(trx, components) });
    }
    if (requires.includes('threads')) {
      found.set('threads', {
        ...none,
        count: await openThreads(trx, [input.artifactId, ...components]),
      });
    }
    if (requires.includes('sections')) {
      const rules = await documentRules(trx, input.artifactId);
      const missing = rules.bound ? missingSections(rules.definition, read.outline) : [];
      found.set('sections', {
        ...none,
        count: missing.length,
        names: missing.map((each) => each.title),
      });
    }
    const asDecider = requires.filter(
      (each) => each === 'bindings' || each === 'revisions' || each === 'components',
    );
    if (asDecider.length > 0) {
      const outcomes = await resolveOccurrences(trx, read.outline, input.principal);
      const unreadable = new Set(
        outcomes.flatMap((each) =>
          each.outcome === 'unreadable' ? [references.get(each.node)!.component] : [],
        ),
      ).size;
      if (requires.includes('bindings') || requires.includes('revisions')) {
        const bindings = await documentBindings(trx, input.artifactId, latest, outcomes);
        found.set('bindings', { ...none, count: bindings.unresolved.length, unreadable });
        found.set('revisions', {
          ...none,
          count: bindings.held.reduce((sum, each) => sum + each.revisions.length, 0),
          unreadable,
        });
      }
      if (requires.includes('components')) {
        found.set('components', {
          ...none,
          ...(await notApproved(trx, outcomes, references)),
          unreadable,
        });
      }
    }
  }
  return requires.flatMap((condition) => {
    const each = found.get(condition);
    return each && (each.count > 0 || each.unreadable > 0) ? [{ condition, ...each }] : [];
  });
}

/**
 * The readable components a document assembles at a version that is no designated revision (LIF-039;
 * WF3-E), each placement judged, and each failing component named once by its latest title: an
 * `approved` reference is met where its component has any revision, an unresolved one never.
 */
async function notApproved(
  trx: TenantTransaction,
  outcomes: Awaited<ReturnType<typeof resolveOccurrences>>,
  references: ReadonlyMap<string, { component: string; approved: boolean }>,
): Promise<{ count: number; names: string[] }> {
  const placed: { component: string; version: string | 'approved' | null }[] = [];
  for (const each of outcomes) {
    if (each.outcome === 'resolved') {
      placed.push({ component: each.component, version: each.version });
    } else if (each.outcome === 'unresolved') {
      const reference = references.get(each.node)!;
      placed.push({
        component: reference.component,
        version: reference.approved ? 'approved' : null,
      });
    }
  }
  if (placed.length === 0) return { count: 0, names: [] };
  const designated = await trx
    .selectFrom('revision_designation')
    .select(['artifact_id', 'version_id'])
    .where('artifact_id', 'in', [...new Set(placed.map((each) => each.component))])
    .execute();
  const failing = [
    ...new Set(
      placed
        .filter(({ component, version }) =>
          version === 'approved'
            ? !designated.some((row) => row.artifact_id === component)
            : !designated.some(
                (row) => row.artifact_id === component && row.version_id === version,
              ),
        )
        .map((each) => each.component),
    ),
  ];
  if (failing.length === 0) return { count: 0, names: [] };
  const heads = await trx
    .selectFrom('artifact_version')
    .select(['id', 'artifact_id'])
    .distinctOn('artifact_id')
    .where('artifact_id', 'in', failing)
    .orderBy('artifact_id')
    .orderBy('revision_no', 'desc')
    .orderBy('version_no', 'desc')
    .execute();
  const titles = await titlesOf(
    trx,
    heads.map((row) => row.id),
  );
  return {
    count: failing.length,
    names: heads.map((row) => titles.get(row.id) ?? '').sort((a, b) => a.localeCompare(b)),
  };
}
