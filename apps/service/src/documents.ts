import type {
  CreateDocumentBody,
  DocumentParams,
  DocumentListQuery,
  DocumentParametersBody,
  DocumentParametersQuery,
  DocumentParametersView,
  DocumentValuesBody,
  DocumentView,
  OutlineOperationBody,
  SpaceParams,
} from '@alloy-works/api-contract';
import { cursorFor, pageAsked } from './listing.js';
import {
  createDocument,
  documentLayout,
  documentRules,
  documentTemplate,
  editOutline,
  listReadableDocuments,
  loadFacts,
  loadFactsFor,
  numberingInputs,
  parameterHistory,
  readLocks,
  recordDocumentParameters,
  recordDocumentValues,
  versionContents,
  readableComponents,
  readDocument,
  readVersion,
  type ParameterValuesRefused,
  type ParametersFixed,
  type ParametersRefused,
  type StoredDocument,
  type StoredVersion,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
  type ValuesRefused,
  type PublishingState,
} from '@alloy-works/db';
import {
  conditions,
  decide,
  number,
  PUBLISHING_FORMATS,
  readOutline,
  resolve,
  templateDefinitionSchema,
  walkOutline,
  withholdComponents,
  type Contribution,
} from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { afterVersion, fieldViews, lockView, versionCursor, versionView } from './components.js';
import type { AppError } from './errors.js';
import type { SessionPrincipal } from './sessions.js';
import { PARAMETER_WORDS } from './templates.js';
import { refused } from './wire-codes.js';

/** Who a document is being shown to, in the transaction their permission was decided in. */
interface Viewer {
  readonly trx: TenantTransaction;
  readonly principalId: string;
  readonly mayEdit: boolean;
  readonly mayPublish: boolean;
}

/**
 * The outline as this viewer is shown it (structure.md, "Who is shown what"): a reference to a
 * component they may not read has its component and pinned version withheld, because access.md makes
 * a thing they may not read indistinguishable from one that does not exist. **Only the view**: the
 * stored outline, its digests and its versions are never computed from what this returns.
 *
 * An outline that does not read is shown as nothing at all - an empty member, which no renderer reads
 * as an outline - rather than as stored, because what cannot be parsed cannot have its references
 * withheld either. The page says it could not be read, as it did when the stored value came back.
 */
async function outlineView(
  viewer: Viewer,
  document: string,
  version: StoredVersion,
): Promise<Record<string, unknown>> {
  const read = readOutline(version.content, { artifact: document, version: version.id });
  if (!read.ok) return {};
  const components: string[] = [];
  walkOutline(read.outline.nodes, (node) => {
    if (node.type === 'reference') components.push(node.component);
  });
  const readable = await readableComponents(viewer.trx, viewer.principalId, components);
  return withholdComponents(read.outline, (component) => readable.has(component));
}

/**
 * The fields a document's template applies to it and to its sections, at the current definitions
 * (definitions.md, "A document's and a section's"), with the schemas behind them by name: read through
 * the document, as a component's are through it. None for a blank document, and none while its
 * template does not resolve, since then there is nothing to check a value against.
 */
async function documentFields(viewer: Viewer, document: string) {
  const rules = await documentRules(viewer.trx, document);
  if (!rules.bound || !rules.resolved.ok) {
    return { fields: { document: [], section: [] }, schemas: [] };
  }
  return {
    fields: {
      document: fieldViews(rules.resolved.document),
      section: fieldViews(rules.resolved.section),
    },
    schemas: rules.schemas.map((each) => ({ id: each.id, name: each.name })),
  };
}

/**
 * The template a document was made from, at the version it was made from (TPL-025), named as that
 * version names it - or null for a blank document, and for a template this viewer may not read, which
 * access.md makes indistinguishable from none.
 */
async function templateView(viewer: Viewer, document: string): Promise<DocumentView['template']> {
  const link = await documentTemplate(viewer.trx, document);
  if (!link) return null;
  const facts = await loadFacts(viewer.trx, viewer.principalId, {
    kind: 'artifact',
    id: link.template,
  });
  if (!facts || !decide('read', facts).allowed) return null;
  const version = await readVersion(viewer.trx, link.version);
  if (!version) throw new Error(`The template version ${link.version} a document names is gone`);
  return {
    id: link.template,
    name: templateDefinitionSchema.parse(version.content).name,
    version: { id: version.id, number: `${version.revision}.${version.version}` },
  };
}

/**
 * A document as the API shows it: at one version, with whether the caller may restructure it and the
 * layout it is numbered and published under. Every answer that carries an outline is built here - the
 * page, an act's answer, and a refusal's `current` - so none can carry an outline that has not been
 * through `outlineView`, and none is shown beside numbers taken from a different scheme.
 *
 * The layout is the document's - its template's, or the environment's for a document made blank
 * (templates.md) - read fresh in this transaction, which is the version a publish requested now would
 * be made under (`requestPublication`). A layout belongs to the environment, not to any space, so
 * nothing here is derived from something the viewer may not read, whether or not they may read the
 * template that chose it. A layout that is missing or does not read throws: a broken store rather than
 * an answer. **Never a fallback to the product's default scheme** - that
 * would show numbers no publish could produce, which is the one thing this is here to prevent.
 *
 * The layout costs four indexed reads and a parse on every document answer - the declaration, the
 * latest version's id, its row, and its definitions - measured at one to two milliseconds before
 * templates. A document made from a template adds the read of its link and its template version for
 * the layout, again for its fields, and its schemas' and fields' latest versions (W5.4); none of it is
 * cached: a layout, a template or a field may be revised between two requests, and a page showing
 * numbers or fields that have since moved would show what no publish or save would use.
 */
async function documentView(
  viewer: Viewer,
  document: Pick<StoredDocument, 'id' | 'space'>,
  version: StoredVersion,
): Promise<DocumentView> {
  const layout = await documentLayout(viewer.trx, document.id);
  return {
    id: document.id,
    space: document.space,
    version: versionView(version),
    outline: await outlineView(viewer, document.id, version),
    values: { ...version.values },
    parameters: { ...version.parameters },
    ...(await documentFields(viewer, document.id)),
    template: await templateView(viewer, document.id),
    mayEdit: viewer.mayEdit,
    mayPublish: viewer.mayPublish,
    layout: {
      id: layout.artifactId,
      version: { id: layout.versionId, number: layout.number },
      language: layout.layout.language,
      scheme: { ...layout.layout.scheme },
      words: { ...layout.layout.words },
      // Every layout makes the PDF; Word only where it declares a Word page (Word 1, ruling R4).
      formats: PUBLISHING_FORMATS.filter((format) => layout.layout.formats[format] !== undefined),
    },
  };
}

/**
 * Values that do not fit, or a template that no longer resolves to check them against (templates.md,
 * "Values") - each named. Told only to a caller who is not stale, as `outline_invalid` is.
 */
async function refusedValues(
  viewer: Viewer,
  id: string,
  openedFrom: string,
  answer: ValuesRefused,
): Promise<never> {
  const current = await latestView(viewer, id);
  if (current.version.id !== openedFrom) throw stale(current);
  // Its own code, not `template_unresolved`: that one's rule is TPL-004's, about making a document.
  if (answer.answer === 'template.unresolved') {
    throw refused(
      400,
      'values.unresolved',
      "This document's template names a schema or field that no longer resolves, so no value can be checked.",
      { unresolved: answer.unresolved },
    );
  }
  throw refused(400, 'values.invalid', 'A value does not fit its field.', {
    failures: answer.failures,
  });
}

/**
 * Parameter values refused, at creation or change (templates.md, "Failures"), each by name: the
 * parameter's own words, with what each names.
 */
function refusedParameters(
  answer: ParameterValuesRefused | ParametersRefused | ParametersFixed,
): AppError {
  switch (answer.answer) {
    case 'parameter.unknown':
      return refused(400, 'parameter.unknown', PARAMETER_WORDS.unknown, {
        parameters: answer.parameters.map((parameter) => ({ parameter })),
      });
    case 'parameter.fixed':
      return refused(400, 'parameter.fixed', PARAMETER_WORDS.fixed, {
        parameters: answer.parameters.map((parameter) => ({ parameter })),
      });
    case 'parameter.invalid':
      return refused(400, 'parameter.invalid', PARAMETER_WORDS.invalid, {
        problems: answer.problems.map(({ parameter, rule, value, field }) => ({
          parameter,
          rule,
          value,
          ...(field === undefined ? {} : { field }),
        })),
      });
    case 'parameter.unused':
    case 'parameter.field':
      return refused(
        400,
        answer.answer,
        answer.answer === 'parameter.unused' ? PARAMETER_WORDS.unused : PARAMETER_WORDS.field,
        {
          parameters: answer.problems.map(({ parameter, field, message }) => ({
            parameter,
            ...(field === undefined ? {} : { field }),
            message,
          })),
        },
      );
  }
}

/** The precondition's refusal, carrying the document as it now stands so the caller can look again. */
function stale(current: DocumentView): AppError {
  return refused(
    409,
    'version.precondition',
    'This document has a newer version than the one this page opened.',
    { current },
  );
}

/**
 * The document as it now stands, for a refusal to carry. Read in the handler's transaction; a
 * document is never removed, so one that authorised a moment ago is still there.
 */
async function latestView(viewer: Viewer, id: string) {
  const latest = await readDocument(viewer.trx, id);
  if (!latest) throw notFound();
  return documentView(viewer, latest, latest.version);
}

/**
 * The document and its latest version's outline, for the routes that number it. A document that is
 * missing or unreadable is not found; a stored outline that does not read is a broken store, thrown as
 * the outline route throws it.
 */
async function latestOutline(trx: TenantTransaction, id: string) {
  const document = await readDocument(trx, id);
  if (!document) throw notFound();
  const read = readOutline(document.version.content, {
    artifact: id,
    version: document.version.id,
  });
  if (!read.ok) {
    throw new Error(`The document ${id} at ${document.version.id} does not read: ${read.failure}`);
  }
  return { document, outline: read.outline };
}

/**
 * The handlers that create, find, open and restructure documents. Each permission-checked one runs in
 * the transaction its permission was decided in; none changes a fact a decision reads - creating an
 * artifact fires no epoch trigger, and a version is not a grant - so none declares `changesAccess`.
 */
export function documentHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
) {
  return {
    listDocuments: async (request: FastifyRequest) => {
      const query = request.query as DocumentListQuery;
      const asked = pageAsked('documents', query);
      const spaces = query.spaces?.split(',');
      const publishing = query.publishing?.split(',') as PublishingState[] | undefined;
      const listed = await db.withTenant(tenantOf(request), (trx) =>
        listReadableDocuments(trx, principalOf(request).principalId, asked, {
          ...(spaces === undefined ? {} : { spaces }),
          ...(publishing === undefined ? {} : { publishing }),
        }),
      );
      if (!listed) throw new Error('A signed-in principal is not in its own tenant');
      return {
        items: listed.items.map((item) => ({
          id: item.id,
          title: item.title,
          space: item.space,
          version: `${item.revision}.${item.version}`,
          changedAt: item.changedAt.toISOString(),
          sections: item.sections,
          components: item.components,
          publishing: item.publishing,
        })),
        next: cursorFor('documents', asked.sort, asked.order, listed.snapshot, listed.next),
        total: listed.total,
        facets: {
          spaces: listed.facets.spaces.map(
            (each: { value: string; label: string; count: number }) => ({ ...each }),
          ),
          publishing: listed.facets.publishing.map(
            (each: { value: string; label: string; count: number }) => ({ ...each }),
          ),
        },
      };
    },

    createDocument: async (request: FastifyRequest, { trx, principalId, facts }: Authorised) => {
      const { space } = request.params as SpaceParams;
      const body = request.body as CreateDocumentBody;
      const answer = await createDocument(trx, {
        spaceId: space,
        title: body.title,
        language: body.language,
        direction: body.direction,
        author: principalId,
        ...(body.template === undefined ? {} : { template: body.template }),
        ...(body.parameters === undefined ? {} : { parameters: body.parameters }),
      });
      // The space was decided on before this ran, so `space.missing` here means it went in the moment
      // between; answered as absent either way, never as a refusal that says it exists.
      // A template the caller may not read is answered as one that does not exist (TE-I).
      if (answer.answer === 'space.missing' || answer.answer === 'template.missing') {
        throw notFound();
      }
      if (answer.answer === 'template.unresolved') {
        throw refused(
          400,
          'template.unresolved',
          'This template names a theme, layout, schema or field that does not resolve.',
          { unresolved: answer.unresolved },
        );
      }
      if (answer.answer === 'content.invalid') {
        throw refused(
          400,
          'content.invalid',
          'A document needs a title and a language tag such as en-GB.',
        );
      }
      if (answer.answer !== 'created') throw refusedParameters(answer);
      const held = await trx
        .selectFrom('space')
        .select(['id', 'name'])
        .where('id', '=', space)
        .executeTakeFirstOrThrow();
      // Decided against the space, as `createComponent` decides it: the document did not exist when
      // the facts were loaded, so no denial on it can exist yet.
      return documentView(
        {
          trx,
          principalId,
          mayEdit: decide('edit', facts).allowed,
          mayPublish: decide('publish', facts).allowed,
        },
        { id: answer.version.artifactId, space: held },
        answer.version,
      );
    },

    getDocument: async (request: FastifyRequest, { trx, principalId, facts }: Authorised) => {
      const { id } = request.params as DocumentParams;
      // `authorise` never looks at an artifact's kind, so a component's id authorises cleanly here;
      // `readDocument` answers nothing for it, and neither does this.
      const document = await readDocument(trx, id);
      if (!document) throw notFound();
      const viewer = {
        trx,
        principalId,
        mayEdit: decide('edit', facts).allowed,
        mayPublish: decide('publish', facts).allowed,
      };
      return documentView(viewer, document, document.version);
    },

    /**
     * What each occurrence of the latest version contributes, as this caller is shown it: the same
     * `numberingInputs` the numbering route reads, so a component they may not read is never read and
     * its occurrence answers `null` twice - no version, and no contributions. The renderer numbers
     * with these and the same `number`, so its numbers are the numbering route's.
     */
    getContributions: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as DocumentParams;
      const { document, outline } = await latestOutline(trx, id);
      const inputs = await numberingInputs(trx, outline, principalId);
      // Each version once, however many occurrences resolved to it: a known occurrence's version and
      // its contributions are both there, and an unknown one's version is null.
      const versions = new Map<string, readonly Contribution[]>();
      for (const occurrence of inputs.occurrences) {
        const known = inputs.contributions.get(occurrence.node);
        if (occurrence.version !== null && known !== undefined) {
          versions.set(occurrence.version, known);
        }
      }
      return {
        document: id,
        version: { id: document.version.id, number: versionView(document.version).number },
        occurrences: inputs.occurrences.map((occurrence) => ({ ...occurrence })),
        versions: [...versions].map(([version, contributions]) => ({
          id: version,
          contributions: contributions.map((each) => ({
            block: each.block,
            sequence: each.sequence,
            numbered: each.numbered,
            caption: each.caption ?? null,
          })),
        })),
      };
    },

    /**
     * The text of every component the latest version places, as this caller is shown it (interface
     * slice 9): resolved by the same `numberingInputs` as the contributions route, so a component they
     * may not read is never read and its occurrence answers `null`, and each resolved version's
     * content and number read once, in one query - the number is what the view's label shows (CNT-162).
     */
    getDocumentTexts: async (
      request: FastifyRequest,
      { trx, principalId, facts: onDocument }: Authorised,
    ) => {
      const { id } = request.params as DocumentParams;
      const { document, outline } = await latestOutline(trx, id);
      const inputs = await numberingInputs(trx, outline, principalId);
      const resolved = [
        ...new Set(
          inputs.occurrences.flatMap((occurrence) =>
            occurrence.version === null ? [] : [occurrence.version],
          ),
        ),
      ];
      const contents = await versionContents(trx, resolved);
      // Whether the caller may edit each component now, and who holds it (CNT-074), decided as the
      // component's own route decides it - of every component the caller may read, whether or not
      // its occurrence has a version to show, and said of no component they may not. The facts and
      // the locks are each read once for the whole document, not once per component.
      const componentOf = new Map<string, string>();
      walkOutline(outline.nodes, (node) => {
        if (node.type === 'reference') componentOf.set(node.id, node.component);
      });
      const facts = await loadFactsFor(trx, principalId, [...componentOf.values()]);
      const readable = [...facts].flatMap(([component, known]) =>
        decide('read', known).allowed ? [component] : [],
      );
      const locks = await readLocks(trx, readable);
      const editing = new Map(
        readable.map((component) => {
          const lock = locks.get(component);
          return [
            component,
            {
              // Masked by the request's token, as the document's own flags are (TK-A).
              mayEdit: decide('edit', { ...facts.get(component)!, scopes: onDocument.scopes })
                .allowed,
              lock: lock ? lockView(lock, principalId) : null,
            },
          ] as const;
        }),
      );
      return {
        document: id,
        version: { id: document.version.id, number: versionView(document.version).number },
        occurrences: inputs.occurrences.map((occurrence) => {
          const component = componentOf.get(occurrence.node);
          const known = component === undefined ? undefined : editing.get(component);
          return { ...occurrence, mayEdit: known?.mayEdit ?? false, lock: known?.lock ?? null };
        }),
        versions: resolved.flatMap((version) => {
          const held = contents.get(version);
          return held === undefined
            ? []
            : [
                {
                  id: version,
                  number: `${held.revision}.${held.version}`,
                  content: held.content as Record<string, unknown>,
                },
              ];
        }),
      };
    },

    /**
     * The latest version's numbering, as this caller is shown it (structure.md, "Numbering" and "Who
     * is shown what"). A component they may not read is never read (`numberingInputs`), so no number
     * here was computed from one, and every number such an occurrence could have moved is null rather
     * than guessed. A stored outline that does not read is a broken store, thrown as the outline route
     * throws it.
     *
     * Numbered with the **document's layout's** scheme - its template's, or the environment's - not
     * the product's default: the numbers a reader is shown are the numbers that would publish
     * (STR-036), since a request made now is made under this same layout version. The layout is named beside them, so a caller can tell which
     * scheme produced them.
     */
    getNumbering: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as DocumentParams;
      const { document, outline } = await latestOutline(trx, id);
      const layout = await documentLayout(trx, id);
      const inputs = await numberingInputs(trx, outline, principalId);
      const table = number(
        conditions(resolve(outline, inputs.contributions)),
        layout.layout.scheme,
      );
      return {
        document: id,
        version: { id: document.version.id, number: versionView(document.version).number },
        scheme: table.scheme,
        layout: {
          id: layout.artifactId,
          version: { id: layout.versionId, number: layout.number },
        },
        // Copied, because the domain's answers are read-only and the wire's types are not.
        occurrences: inputs.occurrences.map((occurrence) => ({ ...occurrence })),
        entries: table.entries.map((entry) => ({ ...entry, sections: [...entry.sections] })),
      };
    },

    /**
     * One structural act, and one version. **A stale caller is told it is stale before anything
     * else**, whatever else is wrong with what it sent: the store applies the operation to the version
     * the caller opened from, so an operation that does not apply there - a node somebody else has
     * since added, say - would otherwise be answered `outline_invalid`, which leaves the caller with
     * nothing to recover from. Answered `version_precondition` with the outline as it stands, they can
     * look again and act on that. Only an operation refused against the latest version is
     * `outline_invalid`. An opened-from version that is not one of this document's is stale in the
     * same sense, as `cutVersion` already answers one that is not the component's latest.
     */
    /**
     * The document's own values, whole, as one version with the outline unchanged (templates.md,
     * "Values"). Stale before anything else, as an outline act is.
     */
    recordDocumentValues: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ): Promise<DocumentView> => {
      const { id } = request.params as DocumentParams;
      const body = request.body as DocumentValuesBody;
      const viewer = {
        trx,
        principalId,
        mayEdit: decide('edit', facts).allowed,
        mayPublish: decide('publish', facts).allowed,
      };
      const document = await readDocument(trx, id);
      if (!document) throw notFound();
      const answer = await recordDocumentValues(trx, {
        documentId: id,
        openedFrom: body.openedFrom,
        author: principalId,
        values: body.values,
      });
      switch (answer.answer) {
        case 'recorded':
          return documentView(viewer, document, answer.version);
        case 'version.unchanged':
          return documentView(viewer, document, answer.current);
        case 'version.precondition':
          throw stale(await documentView(viewer, document, answer.current));
        case 'artifact.missing':
          throw stale(await latestView(viewer, id));
        case 'values.invalid':
        case 'template.unresolved':
          return refusedValues(viewer, id, body.openedFrom, answer);
      }
    },

    /**
     * The document's parameters, whole, as one version with its outline and values unchanged
     * (templates.md, "Recorded on the document"). Stale before anything else, as a values write is.
     */
    recordDocumentParameters: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ): Promise<DocumentView> => {
      const { id } = request.params as DocumentParams;
      const body = request.body as DocumentParametersBody;
      const viewer = {
        trx,
        principalId,
        mayEdit: decide('edit', facts).allowed,
        mayPublish: decide('publish', facts).allowed,
      };
      const document = await readDocument(trx, id);
      if (!document) throw notFound();
      const answer = await recordDocumentParameters(trx, {
        documentId: id,
        openedFrom: body.openedFrom,
        author: principalId,
        parameters: body.parameters,
      });
      switch (answer.answer) {
        case 'recorded':
          return documentView(viewer, document, answer.version);
        case 'version.unchanged':
          return documentView(viewer, document, answer.current);
        case 'version.precondition':
          throw stale(await documentView(viewer, document, answer.current));
        case 'artifact.missing':
          throw stale(await latestView(viewer, id));
        default: {
          // Told only to a caller who is not stale, as a value refused is.
          const current = await latestView(viewer, id);
          if (current.version.id !== body.openedFrom) throw stale(current);
          throw refusedParameters(answer);
        }
      }
    },

    /**
     * A document's parameters (TPL-020): what the template version it was made from declares, its
     * values now, and a page of their history, newest first.
     */
    getDocumentParameters: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<DocumentParametersView> => {
      const { id } = request.params as DocumentParams;
      const query = request.query as DocumentParametersQuery;
      const document = await readDocument(trx, id);
      if (!document) throw notFound();
      const after = afterVersion(query.cursor);
      const rules = await documentRules(trx, id);
      const history = await parameterHistory(trx, id, {
        limit: query.limit === undefined ? 50 : Number(query.limit),
        ...(after === undefined ? {} : { after }),
      });
      return {
        declarations: rules.bound ? [...(rules.definition.parameters ?? [])] : [],
        parameters: { ...document.version.parameters } as DocumentParametersView['parameters'],
        history: history.items.map((each) => ({
          version: {
            id: each.version.id,
            number: `${each.version.revision}.${each.version.version}`,
          },
          createdAt: each.createdAt.toISOString(),
          author: each.author,
          parameters: { ...each.parameters } as DocumentParametersView['parameters'],
          changed: [...each.changed],
        })),
        next: versionCursor(history.next),
      };
    },

    editOutline: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ): Promise<DocumentView> => {
      const { id } = request.params as DocumentParams;
      const body = request.body as OutlineOperationBody;
      const viewer = {
        trx,
        principalId,
        mayEdit: decide('edit', facts).allowed,
        mayPublish: decide('publish', facts).allowed,
      };
      const document = await readDocument(trx, id);
      if (!document) throw notFound();
      const answer = await editOutline(trx, {
        artifactId: id,
        openedFrom: body.openedFrom,
        author: principalId,
        operation: body.operation,
      });
      switch (answer.answer) {
        case 'recorded':
          return documentView(viewer, document, answer.version);
        case 'version.unchanged':
          // Decision K: putting something back where it was is not an error, and the chain keeps no
          // row for it - the same answer `cutVersion` gives for a cut with nothing in it.
          return documentView(viewer, document, answer.current);
        case 'version.precondition':
          throw stale(await documentView(viewer, document, answer.current));
        case 'artifact.missing':
          // The document is there - it was read above - so it is the opened-from version that is not.
          throw stale(await latestView(viewer, id));
        case 'values.invalid':
        case 'template.unresolved':
          return refusedValues(viewer, id, body.openedFrom, answer);
        case 'outline.invalid': {
          // Versions are only ever appended, so a latest that is not the opened-from version now
          // never will be again: no lock is needed to know the caller is stale.
          const current = await latestView(viewer, id);
          if (current.version.id !== body.openedFrom) throw stale(current);
          // A fixed message; the reason is one of the domain's own constants, never an exception's
          // text (operations.ts), so it is safe to carry as a member.
          throw refused(
            400,
            'outline.invalid',
            'This change does not apply to the outline as it stands.',
            { reason: answer.reason },
          );
        }
      }
    },
  };
}
