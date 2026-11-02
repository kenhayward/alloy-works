import {
  decide,
  declaredLanguageOf,
  languageServes,
  readOutline,
  walkOutline,
  withLanguage,
  type OutlineDocument,
  type OutlineNode,
  type Permission,
} from '@alloy-works/domain';
import { loadFactsFor } from './access-facts.js';
import { isArchived } from './archival.js';
import { isDeleted } from './deletion.js';
import { recordRepoints } from './documents.js';
import { readLocks } from './editing.js';
import type { TenantTransaction } from './tables.js';
import { declareSourceChange } from './translation.js';
import {
  latestVersion,
  lockAll,
  readVersion,
  recordVersion,
  substanceOf,
  type StoredVersion,
} from './versions.js';

/** How many components a language change left as they were, and why; counts, as some may be unreadable. */
export interface LanguageSkips {
  readonly notPermitted: number;
  readonly locked: number;
  readonly pinnedBehind: number;
  readonly translated: number;
  readonly missing: number;
}

export type DocumentLanguageAnswer =
  | {
      readonly answer: 'changed' | 'unchanged';
      readonly version: StoredVersion;
      /** The components given a new version: ones the caller may edit, so theirs to know of. */
      readonly changed: readonly string[];
      readonly skipped: LanguageSkips;
    }
  | { readonly answer: 'artifact.missing' }
  | { readonly answer: 'artifact.archived' }
  | { readonly answer: 'version.precondition'; readonly current: StoredVersion }
  | { readonly answer: 'outline.invalid'; readonly reason: string };

/** Each reference in an outline, its pin moved where `moved` names the version it stands at. */
function repinned(
  nodes: readonly OutlineNode[],
  moved: ReadonlyMap<string, string>,
): readonly OutlineNode[] {
  return nodes.map((node) => {
    if (node.type === 'section') return { ...node, children: repinned(node.children, moved) };
    const to = node.mode.kind === 'pinned' ? moved.get(node.mode.version) : undefined;
    return to === undefined ? node : { ...node, mode: { kind: 'pinned' as const, version: to } };
  });
}

/** The open language lines of these components, by component. */
async function openLines(
  trx: TenantTransaction,
  components: readonly string[],
): Promise<Map<string, string[]>> {
  const lines = new Map<string, string[]>();
  if (components.length === 0) return lines;
  const rows = await trx
    .selectFrom('artifact_line as l')
    .select(['l.artifact_id', 'l.language'])
    .where('l.artifact_id', 'in', [...components])
    .where('l.language', 'is not', null)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom('line_closed as c').select('c.line_id').whereRef('c.line_id', '=', 'l.id'),
        ),
      ),
    )
    .execute();
  for (const row of rows) {
    lines.set(row.artifact_id, [...(lines.get(row.artifact_id) ?? []), row.language!]);
  }
  return lines;
}

/**
 * A document's language (the DL plan, L6-L8), and with `components` each component it references, in one
 * transaction: every artifact locked first, in id order as a delivery locks them, so the answer cannot
 * change under it. A component that cannot be changed is skipped and counted, never failing the rest. A
 * version changing only the language asks for no retranslation. Who may edit the document is the
 * caller's; each component is decided here.
 */
export async function setDocumentLanguage(
  trx: TenantTransaction,
  input: {
    readonly artifactId: string;
    readonly openedFrom: string;
    readonly author: string;
    readonly scopes: readonly Permission[] | undefined;
    readonly language: string;
    readonly components: boolean;
  },
): Promise<DocumentLanguageAnswer> {
  const opened = await readVersion(trx, input.openedFrom);
  if (!opened || opened.artifactId !== input.artifactId || opened.kind !== 'document') {
    return { answer: 'artifact.missing' };
  }
  const read = readOutline(opened.content, { artifact: input.artifactId, version: opened.id });
  if (!read.ok) {
    throw new Error(
      `The document ${input.artifactId} at ${opened.id} does not read: ${read.failure}`,
    );
  }
  const pinsOf = new Map<string, (string | null)[]>();
  walkOutline(read.outline.nodes, (node) => {
    if (node.type !== 'reference') return;
    pinsOf.set(node.component, [
      ...(pinsOf.get(node.component) ?? []),
      node.mode.kind === 'pinned' ? node.mode.version : null,
    ]);
  });
  const referenced = input.components ? [...pinsOf.keys()].sort() : [];
  await lockAll(trx, [input.artifactId, ...referenced]);

  const latest = await latestVersion(trx, input.artifactId);
  if (!latest) return { answer: 'artifact.missing' };
  if (latest.id !== opened.id) return { answer: 'version.precondition', current: latest };
  if (await isArchived(trx, input.artifactId)) return { answer: 'artifact.archived' };

  const direction = (held: 'ltr' | 'rtl') => declaredLanguageOf(input.language)?.direction ?? held;
  const changedOutline = withLanguage(
    read.outline,
    input.language,
    direction(read.outline.direction),
  );
  if (!changedOutline.applied) return { answer: 'outline.invalid', reason: changedOutline.reason };

  const skipped = { notPermitted: 0, locked: 0, pinnedBehind: 0, translated: 0, missing: 0 };
  const moved = new Map<string, string>();
  const changed: string[] = [];
  const facts = await loadFactsFor(trx, input.author, referenced);
  const locks = await readLocks(trx, referenced);
  const lines = await openLines(trx, referenced);
  for (const component of referenced) {
    const current = await latestVersion(trx, component);
    if (!current || current.kind !== 'component' || (await isDeleted(trx, component))) {
      skipped.missing += 1;
      continue;
    }
    // Already there is nothing to skip, whoever is asking.
    const content = current.content as { language: string; direction: 'ltr' | 'rtl' };
    const after = { language: input.language, direction: direction(content.direction) };
    if (content.language === after.language && content.direction === after.direction) continue;
    const allowed = facts.get(component);
    if (
      !allowed ||
      !decide('edit', { ...allowed, scopes: input.scopes }).allowed ||
      (await isArchived(trx, component))
    ) {
      skipped.notPermitted += 1;
      continue;
    }
    if (locks.has(component)) {
      skipped.locked += 1;
      continue;
    }
    if ((pinsOf.get(component) ?? []).some((pin) => pin !== null && pin !== current.id)) {
      skipped.pinnedBehind += 1;
      continue;
    }
    if ((lines.get(component) ?? []).some((line) => languageServes(line, input.language))) {
      skipped.translated += 1;
      continue;
    }
    const answer = await recordVersion(trx, {
      artifactId: component,
      openedFrom: current.id,
      author: input.author,
      substance: { ...substanceOf(current), content: { ...content, ...after } } as never,
    });
    if (answer.answer !== 'recorded') {
      throw new Error(`Component ${component} under its lock answered ${answer.answer}`);
    }
    await declareSourceChange(trx, {
      artifactId: component,
      version: answer.version.id,
      retranslate: false,
      by: input.author,
    });
    moved.set(current.id, answer.version.id);
    changed.push(component);
  }

  const outline: OutlineDocument = {
    ...changedOutline.outline,
    nodes: repinned(changedOutline.outline.nodes, moved) as OutlineDocument['nodes'],
  };
  const recorded = await recordVersion(trx, {
    artifactId: input.artifactId,
    openedFrom: opened.id,
    author: input.author,
    substance: {
      kind: 'document',
      content: outline,
      values: opened.values,
      parameters: opened.parameters,
    },
  });
  if (recorded.answer === 'version.unchanged') {
    return { answer: 'unchanged', version: recorded.current, changed, skipped };
  }
  if (recorded.answer !== 'recorded') {
    throw new Error(`Document ${input.artifactId} under its lock answered ${recorded.answer}`);
  }
  await recordRepoints(trx, recorded.version, read.outline, outline);
  return { answer: 'changed', version: recorded.version, changed, skipped };
}
