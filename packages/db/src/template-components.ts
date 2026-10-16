import {
  bindingsIn,
  readContent,
  type FoundComponent,
  type TemplateDefinition,
} from '@alloy-works/domain';
import { loadReadableSet } from './access-facts.js';
import { readableComponents } from './documents.js';
import { mayReadArtifact } from './queryDefinitions.js';
import type { TenantTransaction } from './tables.js';
import { readVersion } from './versions.js';
import { latestRevisionsOf } from './workflow.js';

/**
 * What a template's required components are for one principal (the R9 plan, R9-C; TPL-070): each, by
 * its key, at the version its mode chooses - its pin where the pin is its own, its head, or its latest
 * revision in effect - with the query definitions that version's bindings name; and which of those
 * definitions the principal may read. A component they may not read, deleted or no component at all has
 * no entry, so resolution names it missing and says no more.
 */
export async function componentReferences(
  trx: TenantTransaction,
  definition: TemplateDefinition,
  by: string,
): Promise<{
  readonly components: ReadonlyMap<string, FoundComponent>;
  readonly definitions: ReadonlySet<string>;
}> {
  const declared = definition.components ?? [];
  const components = new Map<string, FoundComponent>();
  if (declared.length === 0) return { components, definitions: new Set() };
  const readable = await readableComponents(
    trx,
    by,
    declared.map((each) => each.component),
  );
  const approved = await latestRevisionsOf(trx, [
    ...new Set(
      declared
        .filter(
          (each) => readable.has(each.component) && (each.mode?.kind ?? 'approved') === 'approved',
        )
        .map((each) => each.component),
    ),
  ]);
  const named = new Set<string>();
  for (const each of declared) {
    if (!readable.has(each.component)) continue;
    const mode = each.mode ?? { kind: 'approved' as const };
    let version: string | undefined;
    if (mode.kind === 'approved') {
      version = approved.get(each.component)?.versionId;
      if (version === undefined) {
        components.set(each.key, { state: 'unapproved' });
        continue;
      }
    } else if (mode.kind === 'pinned') {
      const pin = await trx
        .selectFrom('artifact_version')
        .select('id')
        .where('id', '=', mode.version)
        .where('artifact_id', '=', each.component)
        .executeTakeFirst();
      if (!pin) {
        components.set(each.key, { state: 'foreign' });
        continue;
      }
      version = pin.id;
    } else {
      version = (
        await trx
          .selectFrom('artifact_version')
          .select('id')
          .where('artifact_id', '=', each.component)
          .orderBy('revision_no', 'desc')
          .orderBy('version_no', 'desc')
          .limit(1)
          .executeTakeFirstOrThrow()
      ).id;
    }
    const stored = await readVersion(trx, version);
    const content = stored && readContent(stored.content, { artifact: each.component, version });
    if (!content || !content.ok) throw new Error(`The component version ${version} does not read`);
    const bindings = [...new Set(bindingsIn(content.document).map((at) => at.binding.query))];
    for (const query of bindings) named.add(query);
    components.set(each.key, { state: 'found', version, bindings });
  }
  // The definitions they name that the principal may read: a query definition in a space they read.
  const set = await loadReadableSet(trx, by);
  const rows =
    named.size === 0 || !set
      ? []
      : await trx
          .selectFrom('artifact')
          .select(['id', 'space_id'])
          .where('id', 'in', [...named])
          .where('kind', '=', 'queryDefinition')
          .execute();
  const definitions = new Set(
    rows
      .filter((row) => mayReadArtifact(set!, { id: row.id, spaceId: row.space_id }))
      .map((row) => row.id),
  );
  return { components, definitions };
}
