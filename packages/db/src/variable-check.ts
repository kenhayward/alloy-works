import { readContent, readOutline, resolveVariable, walkOutline } from '@alloy-works/domain';
import { sql } from 'kysely';
import { variablesByKey } from './definitions.js';
import { resolveOccurrences } from './publishing.js';
import type { TenantTransaction } from './tables.js';
import { documentParameterDeclarations } from './templates.js';
import { latestVersion, readVersion } from './versions.js';

/** Each variable key a content value holds, in reading order, each once. */
function variablesIn(value: unknown, found: Set<string>): Set<string> {
  if (Array.isArray(value)) for (const member of value) variablesIn(member, found);
  else if (typeof value === 'object' && value !== null) {
    const node = value as Record<string, unknown>;
    if (node['type'] === 'variable' && typeof node['name'] === 'string') found.add(node['name']);
    for (const member of Object.values(node)) variablesIn(member, found);
  }
  return found;
}

/**
 * Each variable the components a document's template requires hold that does not resolve yet (TPL-072;
 * the R10 plan, R10-D), by node and key, as `by` reads them: one no variable declares, or whose
 * parameter, field and query all leave it without a value. A query source counts as resolving where
 * the document holds a result of its definition: whether that result is one row is the publish's to
 * say (REU-017). Read in the transaction that made it, so what it names is what it was made with.
 */
export async function unresolvedVariables(
  trx: TenantTransaction,
  documentId: string,
  by: string,
): Promise<{ readonly node: string; readonly key: string }[]> {
  const version = await latestVersion(trx, documentId);
  if (!version || version.kind !== 'document') return [];
  const read = readOutline(version.content, { artifact: documentId, version: version.id });
  if (!read.ok) return [];
  const required = new Set<string>();
  walkOutline(read.outline.nodes, (node) => {
    if (node.type === 'reference' && node.origin !== undefined) required.add(node.id);
  });
  if (required.size === 0) return [];
  const definitions = await variablesByKey(trx);
  const feeds = new Map(
    (await documentParameterDeclarations(trx, documentId)).flatMap((each) =>
      (each.feeds.variables ?? []).map((key) => [key, each.name] as const),
    ),
  );
  const { rows } = await sql<{ definition: string }>`
    select distinct v.content -> 'queryDefinition' ->> 'artifact' as definition
      from binding_resolution r join artifact_version v on v.id = r.dataset_version
     where r.document_id = ${documentId}`.execute(trx);
  const held = new Set(rows.map((row) => row.definition));
  const context = {
    parameters: (version.parameters ?? {}) as Record<string, unknown>,
    values: version.values as Record<string, unknown>,
    feeds,
  };
  const unresolved: { node: string; key: string }[] = [];
  for (const occurrence of await resolveOccurrences(trx, read.outline, by)) {
    if (occurrence.outcome !== 'resolved' || !required.has(occurrence.node)) continue;
    const stored = await readVersion(trx, occurrence.version);
    const content =
      stored && readContent(stored.content, { artifact: occurrence.component, version: stored.id });
    if (!content || !content.ok) continue;
    for (const key of variablesIn(content.document.content, new Set())) {
      const definition = definitions.get(key);
      const resolves =
        definition !== undefined &&
        (resolveVariable(definition, context) !== undefined ||
          (definition.sources.query !== undefined &&
            held.has(definition.sources.query.definition)));
      if (!resolves) unresolved.push({ node: occurrence.node, key });
    }
  }
  return unresolved;
}
