import { readOutline, walkOutline, type OutlineNode, type ReadableSet } from '@alloy-works/domain';
import { mayReadArtifact } from './queryDefinitions.js';
import type { TenantTransaction } from './tables.js';

/**
 * What a section found by search belongs to and places (SCH-053; the R14 plan, R14-C): its document,
 * and each component placed beneath it, once each in outline order, that the reader may read.
 */
export interface SectionMembers {
  readonly document: { readonly id: string; readonly title: string };
  readonly components: readonly { readonly id: string; readonly title: string }[];
}

/** The components a node places, its own and every one beneath it, once each in outline order. */
function placedUnder(node: OutlineNode): string[] {
  const placed: string[] = [];
  walkOutline([node], (each) => {
    if (each.type === 'reference' && !placed.includes(each.component)) placed.push(each.component);
  });
  return placed;
}

/**
 * Each section result's members, keyed `<version>:<node>`: read from the document version it matched
 * in, the titles from the search entries now, so nothing the reader may not read is named.
 */
export async function sectionMembers(
  trx: TenantTransaction,
  readable: ReadableSet,
  sections: readonly {
    readonly document: string;
    readonly version: string;
    readonly node: string;
  }[],
): Promise<Map<string, SectionMembers>> {
  const members = new Map<string, SectionMembers>();
  if (sections.length === 0) return members;
  const versions = await trx
    .selectFrom('artifact_version')
    .select(['id', 'content'])
    .where('id', 'in', [...new Set(sections.map((each) => each.version))])
    .execute();
  const contentOf = new Map(versions.map((each) => [each.id, each.content]));
  const placed = new Map<string, string[]>();
  for (const each of sections) {
    const read = readOutline(contentOf.get(each.version), {
      artifact: each.document,
      version: each.version,
    });
    let found: OutlineNode | undefined;
    if (read.ok) {
      walkOutline(read.outline.nodes, (node) => {
        if (node.id === each.node) found = node;
      });
    }
    placed.set(`${each.version}:${each.node}`, found === undefined ? [] : placedUnder(found));
  }
  const ids = [
    ...new Set([...sections.map((each) => each.document), ...[...placed.values()].flat()]),
  ];
  const entries = await trx
    .selectFrom('search_entry')
    .select(['artifact_id', 'kind', 'title', 'space_id'])
    .where('kind', 'in', ['component', 'document'])
    .where('artifact_id', 'in', ids)
    .execute();
  const titled = new Map(
    entries
      .filter((each) => mayReadArtifact(readable, { id: each.artifact_id, spaceId: each.space_id }))
      .map((each) => [each.artifact_id, each.title]),
  );
  for (const each of sections) {
    const key = `${each.version}:${each.node}`;
    members.set(key, {
      document: { id: each.document, title: titled.get(each.document) ?? '' },
      components: (placed.get(key) ?? []).flatMap((id) => {
        const title = titled.get(id);
        return title === undefined ? [] : [{ id, title }];
      }),
    });
  }
  return members;
}
