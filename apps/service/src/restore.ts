import type {
  DocumentRestorationView,
  PageQuery,
  RestorationView,
  RestoreAnswer,
  RestoreBody,
  RestoreParams,
} from '@alloy-works/api-contract';
import {
  latestVersion,
  previewRestore,
  readableComponents,
  readDocument,
  resolveOccurrences,
  restoreVersion,
  versionTitles,
  type Restoration,
  type RestoreAsked,
  type RestoredValue,
  type RestoreRefusal,
  type TenantTransaction,
} from '@alloy-works/db';
import {
  compareOutlines,
  walkOutline,
  withholdComponents,
  type NotCarried,
  type OutlineDocument,
} from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { afterVersion, versionsPage, versionView } from './components.js';
import { namesUnreadableColumn, storable } from './editing.js';
import type { AppError } from './errors.js';
import { refused } from './wire-codes.js';

/** A refusal as the preview lists it: its wire code and what the author needs to act on. */
function refusalView(refusal: RestoreRefusal): RestorationView['refusals'][number] {
  switch (refusal.answer) {
    case 'restore.locked':
      return {
        code: 'restore_locked',
        holder: { id: refusal.lock.holder, name: refusal.lock.holderName },
      };
    case 'values.invalid':
      return {
        code: 'values_invalid',
        failures: refusal.failures.map((each) => ({ ...each, schemas: [...each.schemas] })),
      };
    case 'restore.unreadable':
      return { code: 'restore_unreadable' };
    case 'restore.unchanged':
      return { code: 'restore_unchanged' };
    case 'content.invalid':
      return { code: 'content_invalid' };
    case 'definition.unreadable':
      return { code: 'definition_unreadable' };
    // A document's: never previewed for a component, whose resolver refuses none of them.
    case 'outline.invalid':
    case 'template.unresolved':
      throw new Error(`A component's restore is not refused ${refusal.answer}`);
  }
}

/** A document's refusal, as its preview lists it (the RS plan, RS-F). */
function documentRefusalView(refusal: RestoreRefusal): DocumentRestorationView['refusals'][number] {
  switch (refusal.answer) {
    case 'outline.invalid':
      return { code: 'outline_invalid', reason: refusal.reason };
    case 'template.unresolved':
      return { code: 'values_unresolved', unresolved: [...refusal.unresolved] };
    case 'values.invalid':
      return {
        code: 'values_invalid',
        failures: refusal.failures.map((each) => ({ ...each, schemas: [...each.schemas] })),
      };
    case 'restore.unreadable':
      return { code: 'restore_unreadable' };
    case 'restore.unchanged':
      return { code: 'restore_unchanged' };
    case 'restore.locked':
      throw new Error('A document has no lock, so its restore is not refused one (COL-N02)');
    case 'content.invalid':
    case 'definition.unreadable':
      throw new Error(`A document's restore is not refused ${refusal.answer}`);
  }
}

/** The same refusal, refusing the write. */
function refuse(refusal: RestoreRefusal): AppError {
  switch (refusal.answer) {
    case 'restore.locked':
      return refused(409, 'restore.locked', 'This component is being edited. Done editing first.', {
        holder: { id: refusal.lock.holder, name: refusal.lock.holderName },
        expectedRelease: refusal.lock.expiresAt.toISOString(),
      });
    case 'values.invalid':
      return refused(400, 'values.invalid', 'A value does not fit its field.', {
        failures: refusal.failures,
      });
    case 'restore.unreadable':
      return refused(409, 'restore.unreadable', 'This version can no longer be read.');
    case 'restore.unchanged':
      return refused(409, 'restore.unchanged', 'The latest version already holds this.');
    // A save's, in its words (editing.ts).
    case 'content.invalid':
      return refused(
        400,
        'content.invalid',
        'The content is not a document this product can store.',
      );
    case 'definition.unreadable':
      return refused(
        403,
        'definition.unreadable',
        'A bound table names a column of a query definition you may not read.',
      );
    // A document's, in the words its outline acts are refused in (documents.ts).
    case 'outline.invalid':
      return refused(
        400,
        'outline.invalid',
        'This change does not apply to the outline as it stands.',
        { reason: refusal.reason },
      );
    case 'template.unresolved':
      return refused(
        400,
        'values.unresolved',
        "This document's template names a schema or field that no longer resolves, so no value can be checked.",
        { unresolved: refusal.unresolved },
      );
  }
}

/**
 * A component's restore checked as a save is, for whoever restores (the RS final review): the
 * content storable, and no bound table naming a column the latest does not of a query definition
 * they may not read (`mayNameColumns`). A document's outline has its own guards (RS-F).
 */
const savedChecks =
  (trx: TenantTransaction, request: FastifyRequest): NonNullable<RestoreAsked['check']> =>
  async (content, latest) => {
    if (!storable(content)) return { answer: 'content.invalid' };
    if (await namesUnreadableColumn(trx, request, content, latest.id)) {
      return { answer: 'definition.unreadable' };
    }
    return undefined;
  };

/**
 * A document's restoration compared with its latest (VER-035; the RS plan, RS-H), each outline
 * withheld for the caller by one readable set, so a withheld node compares equal to itself; and each
 * reference the caller may read named, on each side, by the title of the component version it places
 * there: a node re-pointed places another version on each.
 */
async function documentComparison(
  trx: TenantTransaction,
  principalId: string,
  outlines: NonNullable<Restoration['outlines']>,
) {
  const sides = [outlines.latest, outlines.restored];
  const references: string[] = [];
  for (const side of sides) {
    walkOutline(side.nodes, (node) => {
      if (node.type === 'reference') references.push(node.component);
    });
  }
  const readable = await readableComponents(trx, principalId, references);
  const withheld = (outline: OutlineDocument) =>
    withholdComponents(outline, (component) => readable.has(component));
  const older = withheld(outlines.latest);
  const newer = withheld(outlines.restored);
  const [placedOlder, placedNewer] = await Promise.all(
    sides.map(async (side) =>
      (await resolveOccurrences(trx, side, principalId)).flatMap((each) =>
        each.outcome === 'resolved' ? [{ node: each.node, version: each.version }] : [],
      ),
    ),
  );
  const titleOf = await versionTitles(
    trx,
    [...placedOlder!, ...placedNewer!].map((each) => each.version),
  );
  const named = (placed: readonly { node: string; version: string }[]) =>
    placed.map(({ node, version }) => ({ node, title: titleOf.get(version) ?? '' }));
  return {
    older: older as unknown as Record<string, unknown>,
    newer: newer as unknown as Record<string, unknown>,
    structure: compareOutlines(older, newer).changes.map((each) => ({
      ...each,
    })) as DocumentRestorationView['structure'],
    titles: { older: named(placedOlder!), newer: named(placedNewer!) },
  };
}

/** A field's name now, or null where none is held. */
async function fieldName(trx: TenantTransaction, field: string): Promise<string | null> {
  const definition = await latestVersion(trx, field);
  const name = (definition?.content as { name?: unknown } | undefined)?.name;
  return typeof name === 'string' ? name : null;
}

/** Each value not carried, with its field's name now where one is held. */
async function notCarriedView(trx: TenantTransaction, notCarried: readonly NotCarried[]) {
  return Promise.all(
    notCarried.map(async ({ field, value }) => ({
      field,
      name: await fieldName(trx, field),
      value,
    })),
  );
}

/** Each value the restore would change, with its field's name now where one is held (VER-035). */
async function changedView(trx: TenantTransaction, changed: readonly RestoredValue[]) {
  return Promise.all(
    changed.map(async (each) => ({ ...each, name: await fieldName(trx, each.field) })),
  );
}

/** The write's answer, for a component or a document: the new version, or why not. */
async function restored(
  trx: TenantTransaction,
  request: FastifyRequest,
  principalId: string,
  kind: 'component' | 'document',
): Promise<RestoreAnswer> {
  const { id, version } = request.params as RestoreParams;
  const { latest } = request.body as RestoreBody;
  const answer = await restoreVersion(trx, {
    artifactId: id,
    version,
    latest,
    by: principalId,
    ...(kind === 'component' ? { check: savedChecks(trx, request) } : {}),
  });
  switch (answer.answer) {
    case 'restored':
      return { version: versionView(answer.version) };
    case 'artifact.missing':
      throw notFound();
    case 'version.precondition':
      throw refused(
        409,
        'version.precondition',
        `This ${kind} has a newer version than the one this restore was previewed against.`,
        { current: versionView(answer.current) },
      );
    default:
      throw refuse(answer);
  }
}

/**
 * Restoring an earlier version (the RS plan): a component's (Task 1) and a document's (Task 2), each
 * decided on `edit`, which `authorise` decides beside `read` (RS-A). The preview and the write share
 * one resolver (VER-035). And a document's versions, to whoever may read it.
 */
export function restoreHandlers() {
  return {
    listDocumentVersions: async (request: FastifyRequest, { trx }: Authorised) => {
      const { id } = request.params as RestoreParams;
      const query = request.query as PageQuery;
      const after = afterVersion(query.cursor);
      if (!(await readDocument(trx, id))) throw notFound();
      return versionsPage(trx, id, query.limit, after);
    },

    previewDocumentRestore: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<DocumentRestorationView> => {
      const { id, version } = request.params as RestoreParams;
      const restoration = await previewRestore(trx, { artifactId: id, version, by: principalId });
      if (restoration?.source.kind !== 'document') throw notFound();
      const compared = restoration.outlines
        ? await documentComparison(trx, principalId, restoration.outlines)
        : { older: {}, newer: {}, structure: [], titles: { older: [], newer: [] } };
      return {
        document: id,
        from: versionView(restoration.source),
        latest: versionView(restoration.latest),
        ...compared,
        refusals: restoration.refusals.map(documentRefusalView),
      };
    },

    restoreDocumentVersion: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as RestoreParams;
      if (!(await readDocument(trx, id))) throw notFound();
      return restored(trx, request, principalId, 'document');
    },

    previewRestore: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<RestorationView> => {
      const { id, version } = request.params as RestoreParams;
      const restoration = await previewRestore(trx, {
        artifactId: id,
        version,
        by: principalId,
        check: savedChecks(trx, request),
      });
      if (restoration?.source.kind !== 'component') throw notFound();
      return {
        component: id,
        from: versionView(restoration.source),
        latest: versionView(restoration.latest),
        notCarried: await notCarriedView(trx, restoration.notCarried),
        changed: await changedView(trx, restoration.changed),
        refusals: restoration.refusals.map(refusalView),
      };
    },

    restoreVersion: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<RestoreAnswer> => {
      const { id } = request.params as RestoreParams;
      // The one resolver restores either kind: each route its own.
      if ((await latestVersion(trx, id))?.kind !== 'component') throw notFound();
      return restored(trx, request, principalId, 'component');
    },
  };
}
