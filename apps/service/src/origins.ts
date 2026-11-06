import type { ComponentView } from '@alloy-works/api-contract';
import {
  latestVersion,
  loadFacts,
  originOf,
  readTemplate,
  readVersion,
  type TenantTransaction,
} from '@alloy-works/db';
import { decide } from '@alloy-works/domain';

/**
 * What a component was copied from, as this reader is shown it (REU-059; the ND plan, ND-M): the
 * component and version, or the template, each named only where the reader may read it. Null for a
 * component made, not copied.
 */
export async function originView(
  trx: TenantTransaction,
  id: string,
  principalId: string,
): Promise<ComponentView['origin']> {
  const origin = await originOf(trx, id);
  if (!origin) return null;
  const readable = async (artifact: string) => {
    const facts = await loadFacts(trx, principalId, { kind: 'artifact', id: artifact });
    return facts !== undefined && decide('read', facts).allowed;
  };
  let from: NonNullable<ComponentView['origin']>['from'] = null;
  let version: NonNullable<ComponentView['origin']>['version'] = null;
  if (origin.from !== null && origin.version !== null && (await readable(origin.from))) {
    const latest = await latestVersion(trx, origin.from);
    const at = await readVersion(trx, origin.version);
    if (latest && at) {
      from = {
        id: origin.from,
        title: String((latest.content as { title?: unknown }).title ?? ''),
      };
      version = { id: at.id, number: `${at.revision}.${at.version}` };
    }
  }
  let template: NonNullable<ComponentView['origin']>['template'] = null;
  if (origin.template !== null && (await readable(origin.template.id))) {
    const read = await readTemplate(trx, origin.template.id);
    if (read) template = { id: read.id, name: read.definition.name };
  }
  return { from, version, template, changedSince: origin.changedSince };
}
