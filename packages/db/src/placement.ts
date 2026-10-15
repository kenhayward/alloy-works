import {
  contentSize,
  decide,
  placeSection,
  readOutline,
  referencesUnder,
  requiredKeys,
  walkOutline,
  type OutlineRules,
  type SectionNode,
} from '@alloy-works/domain';
import { loadFacts } from './access-facts.js';
import { isDeleted } from './deletion.js';
import {
  mayReference,
  newNodeIdentifier,
  REFERENCE_REFUSED,
  type OutlineAnswer,
} from './documents.js';
import type { TenantTransaction } from './tables.js';
import { documentRules } from './templates.js';
import { latestVersion, readVersion, recordVersion } from './versions.js';
import { latestRevisionsOf } from './workflow.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What placing another document's section would pull in (REU-046; the R2 plan, R2-F). */
export interface PlacementReport {
  readonly from: {
    readonly document: string;
    /** The source's latest version, which the act is made against. */
    readonly version: string;
    readonly section: { readonly id: string; readonly title: SectionNode['title'] };
  };
  /** One per occurrence, in order. */
  readonly occurrences: number;
  /** Each component placed, once, the author may read: its size at its latest version. */
  readonly components: readonly {
    readonly id: string;
    readonly title: string;
    readonly occurrences: number;
    readonly blocks: number;
    readonly characters: number;
    /** Whether it has an approved revision, which an `approved` reference takes. */
    readonly approved: boolean;
  }[];
  /** How many distinct components it places that the author may not read: placing is refused then. */
  readonly unreadable: number;
  readonly blocks: number;
  readonly characters: number;
}

type Source =
  | { readonly answer: 'missing' }
  | {
      readonly answer: 'found';
      readonly version: string;
      readonly section: { readonly id: string; readonly title: SectionNode['title'] };
      readonly components: readonly string[];
    };

/** The source document's section, read as `by`: missing where either is not theirs to read. */
async function sourceSection(
  trx: TenantTransaction,
  by: string,
  from: string,
  section: string,
): Promise<Source> {
  if (!UUID.test(from)) return { answer: 'missing' };
  const facts = await loadFacts(trx, by, { kind: 'artifact', id: from });
  if (!facts || !decide('read', facts).allowed || (await isDeleted(trx, from))) {
    return { answer: 'missing' };
  }
  const latest = await latestVersion(trx, from);
  if (latest?.kind !== 'document') return { answer: 'missing' };
  const read = readOutline(latest.content, { artifact: from, version: latest.id });
  if (!read.ok) return { answer: 'missing' };
  const components = referencesUnder(read.outline, section);
  if (components === undefined) return { answer: 'missing' };
  let title: SectionNode['title'] = [];
  walkOutline(read.outline.nodes, (node) => {
    if (node.id === section && node.type === 'section') title = node.title;
  });
  return { answer: 'found', version: latest.id, section: { id: section, title }, components };
}

/**
 * The report a placement runs first (REU-046): how many occurrences, which components and how much
 * each holds now, and how many the author may not read, without placing anything.
 */
export async function previewPlacement(
  trx: TenantTransaction,
  input: { readonly by: string; readonly from: string; readonly section: string },
): Promise<
  { readonly answer: 'missing' } | { readonly answer: 'report'; readonly report: PlacementReport }
> {
  const source = await sourceSection(trx, input.by, input.from, input.section);
  if (source.answer === 'missing') return source;
  const counts = new Map<string, number>();
  for (const id of source.components) counts.set(id, (counts.get(id) ?? 0) + 1);
  const readable: string[] = [];
  let unreadable = 0;
  for (const id of counts.keys()) {
    if ((await mayReference(trx, input.by, { component: id, version: null })) === 'ok')
      readable.push(id);
    else unreadable += 1;
  }
  const revisions = await latestRevisionsOf(trx, readable);
  const components = [];
  let blocks = 0;
  let characters = 0;
  for (const id of readable) {
    const latest = await latestVersion(trx, id);
    const size = contentSize(latest?.content);
    const title = (latest?.content as { title?: unknown } | undefined)?.title;
    const occurrences = counts.get(id)!;
    components.push({
      id,
      title: typeof title === 'string' ? title : '',
      occurrences,
      ...size,
      approved: revisions.has(id),
    });
    blocks += size.blocks * occurrences;
    characters += size.characters * occurrences;
  }
  return {
    answer: 'report',
    report: {
      from: { document: input.from, version: source.version, section: source.section },
      occurrences: source.components.length,
      components,
      unreadable,
      blocks,
      characters,
    },
  };
}

export type PlacementAnswer =
  | OutlineAnswer
  | { readonly answer: 'source.missing' }
  | { readonly answer: 'source.moved'; readonly current: string };

/**
 * Another document's section placed into this one (REU-054; R2-F): against the source version the
 * report read, so what is placed is what was reported; each component one the author may reference,
 * as an inserted reference is; a pinned one pinned to its latest version now. One version of the
 * document, held to its template as an inserted section is.
 */
export async function placeFromSection(
  trx: TenantTransaction,
  input: {
    readonly documentId: string;
    readonly openedFrom: string;
    readonly author: string;
    readonly from: string;
    readonly fromVersion: string;
    readonly section: string;
    readonly parent: string | null;
    readonly position: number;
    readonly title: SectionNode['title'];
    readonly mode: 'latest' | 'approved' | 'pinned';
  },
): Promise<PlacementAnswer> {
  const source = await sourceSection(trx, input.author, input.from, input.section);
  if (source.answer === 'missing') return { answer: 'source.missing' };
  if (source.version !== input.fromVersion) {
    return { answer: 'source.moved', current: source.version };
  }
  const opened = await readVersion(trx, input.openedFrom);
  if (!opened || opened.artifactId !== input.documentId || opened.kind !== 'document') {
    return { answer: 'artifact.missing' };
  }
  const read = readOutline(opened.content, { artifact: input.documentId, version: opened.id });
  if (!read.ok) {
    throw new Error(
      `The document ${input.documentId} at ${opened.id} does not read: ${read.failure}`,
    );
  }
  const heads = new Map<string, string>();
  for (const component of new Set(source.components)) {
    if ((await mayReference(trx, input.author, { component, version: null })) !== 'ok') {
      return { answer: 'outline.invalid', reason: REFERENCE_REFUSED };
    }
    const head = await latestVersion(trx, component);
    if (head) heads.set(component, head.id);
  }
  const rules = await documentRules(trx, input.documentId);
  const held: OutlineRules = rules.bound
    ? { changes: rules.changes, required: requiredKeys(rules.definition) }
    : {};
  const applied = placeSection(
    read.outline,
    {
      parent: input.parent,
      position: input.position,
      title: input.title,
      references: source.components.map((component) => ({
        component,
        mode:
          input.mode === 'pinned'
            ? { kind: 'pinned' as const, version: heads.get(component)! }
            : { kind: input.mode },
      })),
    },
    newNodeIdentifier,
    held,
  );
  if (!applied.applied) return { answer: 'outline.invalid', reason: applied.reason };
  return recordVersion(trx, {
    artifactId: input.documentId,
    openedFrom: input.openedFrom,
    author: input.author,
    substance: {
      kind: 'document',
      content: applied.outline,
      values: opened.values,
      parameters: opened.parameters,
    },
  });
}
