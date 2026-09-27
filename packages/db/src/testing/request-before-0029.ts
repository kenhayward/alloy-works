import { defaultLayout } from '../layouts.js';
import { enqueueJob } from '../queue.js';
import type { TenantTransaction } from '../tables.js';
import { defaultTheme } from '../themes.js';

/**
 * A PDF publication request written as `requestPublication` wrote one before 0029: under the
 * environment's declared layout and theme at their latest versions, with its job. Today's
 * `requestPublication` reads `document_template` to find a document's layout and theme, which an
 * environment migrated only to an earlier point does not have, so a migration test requesting there
 * writes the request this way instead. For a document with nothing in its outline, so nothing is
 * resolved, no occurrence recorded and no failure found.
 */
export async function requestBefore0029(
  trx: TenantTransaction,
  input: { readonly documentId: string; readonly version: string; readonly requester: string },
): Promise<string> {
  const layout = await defaultLayout(trx);
  const theme = await defaultTheme(trx);
  const request = await trx
    .insertInto('publication_request')
    .values({
      document_id: input.documentId,
      document_version_id: input.version,
      formats: ['pdf'],
      requested_by: input.requester,
      failures: '[]',
      layout_id: layout.artifactId,
      layout_version_id: layout.versionId,
      theme_id: theme.artifactId,
      theme_version_id: theme.versionId,
    })
    .returning(['id'])
    .executeTakeFirstOrThrow();
  await enqueueJob(trx, 'publish', request.id);
  return request.id;
}
