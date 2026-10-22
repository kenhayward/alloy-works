import type {
  CitationPreview,
  CitationPreviewBody,
  ComponentParams,
} from '@alloy-works/api-contract';
import {
  citedFlags,
  defaultTheme,
  documentTheme,
  latestVersion,
  readableEntries,
  readStyleVersion,
  readVersion,
  type EntryFlag,
  type TenantTransaction,
} from '@alloy-works/db';
import {
  citationPlaces,
  parseContentDocument,
  readOutline,
  walkOutline,
  type ContentDocument,
} from '@alloy-works/domain';
import { renderCitations } from '@alloy-works/domain/citations';
import type { FastifyRequest } from 'fastify';
import { authoriseAt, callerOf, notFound, type Authorised } from '../access.js';
import { refused } from '../wire-codes.js';

/**
 * Citing in the editor (the CI plan, CId, CI-H): what a save may cite, and the in-text forms the
 * editor shows, rendered here so citeproc never reaches the browser.
 */

/** Every entry a component's content cites, by a citation or a cross-reference to it. */
function citedIn(content: ContentDocument): Set<string> {
  return new Set(citationPlaces(content).map((each) => each.entry));
}

/**
 * **A save cites only what its author may read in the component's space** (CI-H; citations.md, "The
 * citation"): a citation naming an entry the version it opened from did not cite is refused
 * `citation_unreadable` unless it is an entry of the component's space its author may read. One the
 * opened version already cited is left alone, so a component carried in from another space can still
 * be edited; its citation fails at publish instead (CI-B).
 */
export async function mayCite(
  trx: TenantTransaction,
  request: FastifyRequest,
  content: ContentDocument,
  openedFrom: string,
): Promise<void> {
  if (await citesUnreadable(trx, request, content, openedFrom)) {
    throw refused(
      400,
      'citation.unreadable',
      "A citation names no bibliography entry of this component's space that you may read.",
    );
  }
}

/** Whether `mayCite` refuses the content: what a restore's checks ask too. */
export async function citesUnreadable(
  trx: TenantTransaction,
  request: FastifyRequest,
  content: ContentDocument,
  openedFrom: string,
): Promise<boolean> {
  const cited = citedIn(content);
  if (cited.size === 0) return false;
  const opened = await readVersion(trx, openedFrom);
  if (!opened) return false;
  let before = new Set<string>();
  try {
    before = citedIn(parseContentDocument(opened.content));
  } catch {
    // A version that no longer parses cites nothing a save could be measured against.
  }
  const added = [...cited].filter((entry) => !before.has(entry));
  if (added.length === 0) return false;
  const space = await trx
    .selectFrom('artifact')
    .select('space_id')
    .where('id', '=', opened.artifactId)
    .executeTakeFirst();
  const readable =
    space?.space_id == null
      ? new Map()
      : await readableEntries(trx, callerOf(request).principalId, space.space_id, added);
  return added.some((entry) => !readable.has(entry));
}

/** Whether a document's latest outline places the component. */
async function places(trx: TenantTransaction, document: string, component: string) {
  const version = await latestVersion(trx, document);
  if (version?.kind !== 'document') return false;
  const read = readOutline(version.content, { artifact: document, version: version.id });
  let found = false;
  if (read.ok) {
    walkOutline(read.outline.nodes, (node) => {
      if (node.type === 'reference' && node.component === component) found = true;
    });
  }
  return found;
}

/** The flags of those of these entries that are the space's (XR-G), whoever may read them. */
async function spaceFlags(
  trx: TenantTransaction,
  space: string,
  ids: readonly string[],
): Promise<Map<string, EntryFlag>> {
  const flags = await citedFlags(trx, ids);
  if (flags.size === 0) return flags;
  const ours = await trx
    .selectFrom('artifact')
    .select('id')
    .where('id', 'in', [...flags.keys()])
    .where('space_id', '=', space)
    .execute();
  const kept = new Set(ours.map((row) => row.id));
  return new Map([...flags].filter(([id]) => kept.has(id)));
}

export function citingHandlers() {
  return {
    /**
     * Each citation's in-text form in the style of the document's theme, or the environment's, null
     * where it names no entry of the component's space the caller may read.
     */
    previewComponentCitations: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<CitationPreview> => {
      const { id } = request.params as ComponentParams;
      const body = request.body as CitationPreviewBody;
      const component = await latestVersion(trx, id);
      if (!component || component.kind !== 'component') throw notFound();
      if (body.document !== undefined) {
        await authoriseAt(trx, callerOf(request), 'read', { kind: 'artifact', id: body.document });
        if (!(await places(trx, body.document, id))) throw notFound();
      }
      const theme =
        body.document === undefined
          ? await defaultTheme(trx)
          : await documentTheme(trx, body.document);
      const named = theme.theme.citationStyle;
      const style = named === null ? undefined : await readStyleVersion(trx, named.version);
      const space = await trx
        .selectFrom('artifact')
        .select('space_id')
        .where('id', '=', id)
        .executeTakeFirst();
      const entries =
        space?.space_id == null
          ? new Map()
          : await readableEntries(
              trx,
              principalId,
              space.space_id,
              body.citations.map((each) => each.entry),
            );
      // A flag is shown on every citation of an entry of the space, read or not (XR-G).
      const flagged =
        space?.space_id == null
          ? new Map<string, EntryFlag>()
          : await spaceFlags(
              trx,
              space.space_id,
              body.citations.map((each) => each.entry),
            );
      const flags = body.citations.map((each) => flagged.get(each.entry) ?? null);
      const shown = body.citations.filter((each) => entries.has(each.entry));
      if (style === undefined || shown.length === 0) {
        return { forms: body.citations.map(() => null), flags };
      }
      const language = (component.content as { language?: string }).language;
      let rendered: ReturnType<typeof renderCitations>;
      try {
        rendered = renderCitations({
          style: style.style.csl,
          ...(language === undefined ? {} : { language }),
          entries: Object.fromEntries(entries),
          citations: shown.map(({ entry, locator }) =>
            locator === undefined ? { entry } : { entry, locator },
          ),
        });
      } catch {
        // A style that no longer renders shows nothing; the publish names it (`style_invalid`).
        return { forms: body.citations.map(() => null), flags };
      }
      let at = 0;
      return {
        forms: body.citations.map((each) =>
          entries.has(each.entry)
            ? (rendered.citations[at++] ?? []).map((run) => run.text).join('')
            : null,
        ),
        flags,
      };
    },
  };
}
