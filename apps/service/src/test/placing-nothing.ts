import {
  createTemplate,
  DEFAULT_LAYOUT_ID,
  DEFAULT_THEME_ID,
  type TenantTransaction,
} from '@alloy-works/db';
import { TEMPLATE_SCHEMA_VERSION } from '@alloy-works/domain';

/**
 * A template placing nothing, for a test that wants a document's outline to start empty: a document
 * made naming no template takes its space's default, Blank, which places one component (the ND plan,
 * ND-B).
 */
export async function placingNothing(
  trx: TenantTransaction,
  space: string,
  author: string,
): Promise<string> {
  const made = await createTemplate(trx, {
    spaceId: space,
    author,
    definition: {
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      name: 'Nothing at all',
      theme: DEFAULT_THEME_ID,
      layout: DEFAULT_LAYOUT_ID,
      schemas: [],
      outline: { sections: [] },
      changes: { add: true, remove: true, reorder: true },
    },
  });
  if (made.answer !== 'created') throw new Error(made.answer);
  return made.template.id;
}
