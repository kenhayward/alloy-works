import {
  outlineMatterSchema,
  outlineOperationSchema,
  PLACE_MAX,
  sectionNodeSchema,
  storableEverywhere,
  storedProfileSchema,
} from '@alloy-works/domain';
import { z } from 'zod';
import { FacetCountView, idsFilter, listingQuery, listingTotal, nextCursor } from './listing.js';
import { CreateComponentBody, FieldView, Lock, SpaceParams, VersionSummary } from './components.js';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid, SPACE_ARCHIVED } from './schemas.js';
import { parameterRefusal, TemplateRefusal } from './templates.js';
import {
  GateView,
  TransitionView,
  WorkflowRevisionView,
  DatesView,
  ScopeView,
  WorkflowStandingView,
  WorkflowStateView,
} from './workflows.js';
import { templateParameterSchema } from '@alloy-works/domain';

/** A document, by the id its artifact carries - lowercase, unlike `ComponentParams`. */
export const DocumentParams = z.object({ id: LowercaseUuid });
export type DocumentParams = z.infer<typeof DocumentParams>;

/**
 * What creating a document takes: a component's header without its type. Picked from
 * `CreateComponentBody`, not restated, so the language rule is written once for both.
 */
export const CreateDocumentBody = CreateComponentBody.pick({
  title: true,
  language: true,
  direction: true,
}).extend({
  template: LowercaseUuid.optional().describe(
    'The template to make it from, at its latest version (templates.md); without one, a blank document',
  ),
  parameters: z
    .record(z.string(), z.unknown())
    .refine(storableEverywhere, 'A value holds a character that cannot be stored')
    .optional()
    .describe(
      "A value for each of the template's parameters, by name: each in its type's canonical form, " +
        'or a list of them where the parameter is a list (templates.md, "Asked for when a document ' +
        'is made"). A required one must be given; none for a blank document',
    ),
  sharesOwnView: z
    .boolean()
    .optional()
    .describe(
      "True to make a document whose required components' queries run as the caller, holding what the source shows them (DAT-091); otherwise such a creation is refused, acknowledgement_required",
    ),
});
export type CreateDocumentBody = z.infer<typeof CreateDocumentBody>;

/** A creation refused where a required component's query failed (the R9 plan, R9-E; TPL-024). */
export const CreationRefusal = ErrorBody.extend({
  failures: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe('creation_failed: each binding whose query failed, as a resolve names one'),
});

/**
 * One structural act (structure.md, "Editing the outline"): the version the caller read the outline
 * at, and one operation from the domain's closed union - imported, never restated, so the contract and
 * the tree cannot disagree about what an operation is.
 */
export const OutlineOperationBody = z.strictObject({
  openedFrom: LowercaseUuid.describe(
    'The version the outline was read at, which must be the latest',
  ),
  operation: outlineOperationSchema,
});
export type OutlineOperationBody = z.infer<typeof OutlineOperationBody>;

/** Where a placement is found: another document's section (REU-054; the R2 plan, R2-F). */
export const PlacementQuery = z.object({
  from: LowercaseUuid.describe('The document the section is in'),
  section: z.string().min(1).max(64).describe("The section's node"),
});
export type PlacementQuery = z.infer<typeof PlacementQuery>;

/** What placing a section pulls in, reported before anything is placed (REU-046). */
export const PlacementReportView = z.object({
  from: z.object({
    document: LowercaseUuid,
    version: LowercaseUuid.describe("The source's latest version: send it back to place"),
    section: z.object({
      id: z.string(),
      title: z.array(z.unknown()).describe("The section's title, as the outline holds it"),
    }),
  }),
  occurrences: z
    .number()
    .int()
    .describe('How many references placing it makes, one per occurrence'),
  components: z
    .array(
      z.object({
        id: LowercaseUuid,
        title: z.string(),
        occurrences: z.number().int(),
        blocks: z.number().int().describe('Its top-level blocks at its latest version'),
        characters: z.number().int().describe('The characters of its text at its latest version'),
        approved: z
          .boolean()
          .describe('Whether it has an approved revision, which an `approved` reference takes'),
      }),
    )
    .describe('Each component it places that the caller may read, once'),
  unreadable: z
    .number()
    .int()
    .describe(
      'How many components it places that the caller may not read, or that are deleted: placing is refused then',
    ),
  blocks: z.number().int().describe('Blocks in all, each occurrence counted'),
  characters: z.number().int().describe('Characters in all, each occurrence counted'),
});
export type PlacementReportView = z.infer<typeof PlacementReportView>;

/** Placing another document's section as references under a new section (REU-054; R2-F). */
export const PlacementBody = z.strictObject({
  openedFrom: LowercaseUuid.describe(
    'The version the outline was read at, which must be the latest',
  ),
  from: LowercaseUuid.describe('The document the section is in'),
  fromVersion: LowercaseUuid.describe(
    'The source version the report read: refused, source_moved, where it is not the latest',
  ),
  section: z.string().min(1).max(64).describe("The section's node"),
  parent: z
    .string()
    .min(1)
    .max(64)
    .nullable()
    .describe('Where the new section goes: a section, or null for the top'),
  position: z.number().int().min(0),
  title: sectionNodeSchema.shape.title.describe("The new section's title, the author's"),
  mode: z
    .enum(['latest', 'approved', 'pinned'])
    .describe(
      `Each reference's mode: pinned takes each component's latest version now. At most ${PLACE_MAX} references`,
    ),
});
export type PlacementBody = z.infer<typeof PlacementBody>;

/**
 * A document's own values, whole (templates.md, "Values"), from the version they were read at: each a
 * field its template applies to the document, the default of each left without a member filled in.
 */
export const DocumentValuesBody = z.strictObject({
  openedFrom: LowercaseUuid.describe(
    'The version the values were read at, which must be the latest',
  ),
  values: z
    .record(z.string(), z.unknown())
    .refine(storableEverywhere, 'A value holds a character that cannot be stored')
    .describe("The document's values, by field identifier"),
});
export type DocumentValuesBody = z.infer<typeof DocumentValuesBody>;

/**
 * A document's parameters, whole (templates.md, "Recorded on the document"), from the version they
 * were read at: one left out is removed, and one its template does not declare changeable must keep
 * its value (TPL-021).
 */
export const DocumentParametersBody = z.strictObject({
  openedFrom: LowercaseUuid.describe(
    'The version the parameters were read at, which must be the latest',
  ),
  parameters: z
    .record(z.string(), z.unknown())
    .refine(storableEverywhere, 'A value holds a character that cannot be stored')
    .describe("The document's parameters, by name"),
});
export type DocumentParametersBody = z.infer<typeof DocumentParametersBody>;

/**
 * A document's profile, whole (REU-022; the R6 plan, R6-B), from the version it was read at, or null to
 * clear it.
 */
export const DocumentProfileBody = z.strictObject({
  openedFrom: LowercaseUuid.describe(
    'The version the profile was read at, which must be the latest',
  ),
  profile: storedProfileSchema
    .nullable()
    .describe(
      'The values the document takes on each condition axis, by key, and `excludeUnset: true` where ' +
        'text conditioned on an axis it does not name may be left out of a publish (REU-053); null clears it',
    ),
});
export type DocumentProfileBody = z.infer<typeof DocumentProfileBody>;

/** A page of a document's parameter history. */
export const DocumentParametersQuery = z.object({
  limit: z
    .string()
    .regex(/^(?:[1-9]|[1-9][0-9]|1[0-9][0-9]|200)$/, 'Expected a whole number from 1 to 200')
    .optional()
    .describe('At most this many changes, 1 to 200; 50 when not given'),
  cursor: z.string().optional().describe('Where the page before ended, as its `next` gave it'),
});
export type DocumentParametersQuery = z.infer<typeof DocumentParametersQuery>;

const parameterValue = z.union([
  z.string(),
  z.boolean(),
  z.array(z.union([z.string(), z.boolean()])),
]);

/** A document's parameters: what its template declares, their values now, and their history. */
export const DocumentParametersView = z.object({
  declarations: z
    .array(templateParameterSchema)
    .describe(
      'The parameters the template version the document was made from declares (templates.md, ' +
        '"Declared on the template"); none for a document made blank',
    ),
  parameters: z
    .record(z.string(), parameterValue)
    .describe("The latest version's parameter values, by name"),
  history: z
    .array(
      z.object({
        version: z.object({ id: z.string(), number: z.string() }),
        createdAt: z.string().describe('When the version was made'),
        author: z
          .object({ id: z.string(), name: z.string().nullable() })
          .nullable()
          .describe('Who made it'),
        parameters: z.record(z.string(), parameterValue).describe('Its parameters, whole'),
        changed: z
          .array(z.string())
          .describe('The parameters whose values it changed: every one it holds, for the first'),
      }),
    )
    .describe(
      "The document's first version and each that changed a parameter, newest first (TPL-020)",
    ),
  next: z.string().nullable().describe('The cursor for the next page, or null at the end'),
});
export type DocumentParametersView = z.infer<typeof DocumentParametersView>;

export const DocumentList = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      space: z.object({ id: z.string(), name: z.string() }),
      version: z.string().describe('`revision.version` of the latest version'),
      changedAt: z.string().describe('When its latest version was made'),
      sections: z.number().int().describe('The sections in its latest outline, at every depth'),
      components: z
        .number()
        .int()
        .describe('The component references in its latest outline, at every depth'),
      publishing: z
        .enum(['published', 'changedSince', 'neverPublished'])
        .describe(
          'Whether the latest publication the caller may read is of the latest version, an earlier one, or there is none they may read',
        ),
      state: WorkflowStateView,
      pastReview: z.boolean().describe('Whether its review-by day has passed (LIF-018)'),
    }),
  ),
  next: nextCursor,
  total: listingTotal,
  facets: z
    .object({ spaces: z.array(FacetCountView), publishing: z.array(FacetCountView) })
    .describe(
      'Each filter the listing takes, counted with the others in force and its own left out',
    ),
});
export type DocumentList = z.infer<typeof DocumentList>;

export const DocumentListQuery = z.object({
  ...listingQuery(['title', 'changed'], 'title'),
  spaces: idsFilter.optional().describe('Only documents in these spaces, by id'),
  publishing: z
    .string()
    .regex(
      /^(?:published|changedSince|neverPublished)(?:,(?:published|changedSince|neverPublished)){0,2}$/,
      'Expected publishing states, separated by commas',
    )
    .optional()
    .describe('Only documents in these publishing states: published, changedSince, neverPublished'),
  archived: z
    .literal('only')
    .optional()
    .describe('only: the archived documents alone. Absent: archived documents are left out'),
});
export type DocumentListQuery = z.infer<typeof DocumentListQuery>;

export const DocumentView = z.object({
  id: z.string(),
  space: z.object({ id: z.string(), name: z.string() }),
  version: VersionSummary,
  outline: z
    .record(z.string(), z.unknown())
    .describe(
      "The latest version's outline document (structure.md), as the caller is shown it: a reference " +
        'to a component the caller may not read carries `component: null`, and a pinned one ' +
        '`mode.version: null`; everything else is as stored. Empty when the stored outline does not read',
    ),
  values: z
    .record(z.string(), z.unknown())
    .describe(
      "The latest version's own field values, by field identifier: empty for a document with no template",
    ),
  parameters: z
    .record(z.string(), z.unknown())
    .describe(
      'The latest version\'s parameter values, by name (templates.md, "Recorded on the document"): ' +
        'empty for a document with none',
    ),
  fields: z
    .object({ document: z.array(FieldView), section: z.array(FieldView) })
    .describe(
      "The fields the document's template applies to the document and to each of its sections, at the " +
        'current definitions; none for a document made blank, or whose template no longer resolves',
    ),
  schemas: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .describe('The schemas behind those fields, by name, for naming which require or fix one'),
  template: z
    .object({
      id: z.string(),
      name: z.string(),
      version: z.object({ id: z.string(), number: z.string() }),
      newest: z
        .object({ id: z.string(), number: z.string() })
        .nullable()
        .describe(
          'The template’s newest version, where it is newer than the one the document is bound to (TPL-033)',
        ),
      required: z
        .array(z.string())
        .describe(
          'The keys of the starting sections it requires: a section from one is removed only with a reason (TPL-029)',
        ),
      departures: z
        .object({
          added: z
            .array(z.object({ node: z.string(), title: z.string() }))
            .describe('Each section the document has that its template does not'),
          missing: z
            .array(
              z.object({
                key: z.string(),
                title: z.string(),
                required: z.boolean(),
                reason: z
                  .string()
                  .nullable()
                  .describe('Why a required one was removed, as its remover said'),
              }),
            )
            .describe('Each starting section none of its sections came from'),
        })
        .describe('How the document departs from its template (TPL-028)'),
    })
    .nullable()
    .describe(
      'The template, and the version of it, the document was made from (TPL-025), named as that ' +
        'version names it. Null for a document made blank, or from a template the caller may not read',
    ),
  mayEdit: z.boolean().describe('Whether the caller may restructure the outline'),
  archived: z
    .boolean()
    .describe(
      'Archived: left out of ordinary listings and search, and still read, referenced and published',
    ),
  mayRetire: z.boolean().describe('Whether the caller may archive and unarchive it'),
  state: WorkflowStandingView,
  transitions: z
    .array(TransitionView)
    .describe('The workflow transitions the caller may take from its state now, in order'),
  gates: z.array(GateView).describe('Each gate from its state, decided by its approvers'),
  revision: WorkflowRevisionView,
  dates: DatesView,
  scope: ScopeView,
  onHold: z
    .boolean()
    .describe(
      "Under a legal hold, its own or its space's; false for a caller who may neither retire it nor administer the environment",
    ),
  mayHold: z
    .boolean()
    .describe('Whether the caller may place a legal hold: an environment administrator'),
  mayPublish: z.boolean().describe('Whether the caller may publish the document'),
  mayComment: z
    .boolean()
    .describe('Whether the caller may start and answer threads on the document'),
  maySuggest: z
    .boolean()
    .describe('Whether the caller may suggest changes to the document’s components where they may'),
  mayReview: z
    .boolean()
    .describe(
      'Whether Review is offered the caller: they may comment on or suggest to the document',
    ),
  layout: z
    .object({
      id: z.string(),
      version: z.object({ id: z.string(), number: z.string() }),
      language: z.string(),
      scheme: z
        .record(z.string(), z.unknown())
        .describe('The numbering scheme this document is numbered and published with'),
      words: z
        .record(z.string(), z.unknown())
        .describe(
          "The layout's own words - the contents' title, the draft notice, and, both or neither, " +
            'what a relative cross-reference prints for above and below (cross-references 2, ruling R9), ' +
            "and `continued`, the words a continued table's label adds after its label, which a layout " +
            'read at schema 3 or before has none of (themes 2, ruling R2), and `preview`, the notice and ' +
            "sentence a preview says in place of the draft's, which a layout read at schema 5 or before " +
            'has none of (the preview, PV-D)',
        ),
      formats: z
        .array(z.string())
        .describe(
          'The formats this layout makes, `pdf` first and then `docx` where it declares a Word page: ' +
            'what a publish may ask for (Word 1, ruling R14)',
        ),
    })
    .describe(
      "The document's layout at its latest version - its template's, or the environment's for a " +
        'document made blank - which is the version a publish requested now would be made under ' +
        '(publishing.md, "The layout"; templates.md)',
    ),
});
export type DocumentView = z.infer<typeof DocumentView>;

/** A document just made: as any document is viewed, and what of it does not resolve yet (TPL-072). */
export const CreatedDocumentView = DocumentView.extend({
  unresolvedVariables: z
    .array(z.object({ node: z.string(), key: z.string() }))
    .describe(
      "Each variable the components its template requires hold that does not resolve yet, by the node placing it and the variable's key: the publish fails on it unless a parameter, field or result gives it a value first (the R10 plan, R10-D)",
    ),
});
export type CreatedDocumentView = z.infer<typeof CreatedDocumentView>;

/**
 * A structural act refused, in the one error shape: the outline as it now stands when somebody else
 * moved first (`version_precondition`), or why the operation does not apply (`outline_invalid`).
 */
export const OutlineRefusal = ErrorBody.extend({
  unknown: z
    .array(z.string())
    .optional()
    .describe('profile_invalid: each axis, or `axis.value`, the environment does not declare'),
  current: DocumentView.optional().describe('version_precondition: the document as it now stands'),
  reason: z.string().optional().describe('outline_invalid: why the operation does not apply'),
  failures: z
    .array(
      z.object({
        code: z.string(),
        field: z.string(),
        rule: z.string(),
        schemas: z.array(z.string()),
        detail: z.string(),
      }),
    )
    .optional()
    .describe("values_invalid: each value that does not fit its field, in MET-022's shape"),
  unresolved: TemplateRefusal.shape.unresolved.describe(
    "values_unresolved: what the document's template names that does not resolve now",
  ),
  ...parameterRefusal,
});
export type OutlineRefusal = z.infer<typeof OutlineRefusal>;

/**
 * A document's numbering (structure.md, "Numbering"), as the caller is shown it: the version it
 * numbers, the scheme and the layout version it came from, which component version each occurrence
 * resolved to, and the numbering table.
 */
export const NumberingView = z.object({
  document: z.string(),
  version: z.object({ id: z.string(), number: z.string() }),
  scheme: z.string().describe("The scheme numbered against, by its id: the layout's"),
  layout: z
    .object({ id: z.string(), version: z.object({ id: z.string(), number: z.string() }) })
    .describe('The layout whose scheme these numbers were taken from, at the version read'),
  occurrences: z
    .array(z.object({ node: z.string(), version: z.string().nullable() }))
    .describe(
      'Each component reference, in outline order, and the component version it resolved to: null ' +
        'where the caller may not read the component, where it waits on revisions, or where its ' +
        'content does not read. Its contributions are then not counted, and every number it could ' +
        'have moved is null',
    ),
  entries: z.array(
    z.object({
      node: z.string().describe('The outline node that produced it'),
      block: z.string().nullable().describe('The block or footnote, for a caption or a footnote'),
      sequence: z.string(),
      matter: outlineMatterSchema,
      sections: z.array(z.number().int()).describe('The section counter stack at this point'),
      value: z.number().int().nullable().describe("This sequence's counter; null when not known"),
      restartedAt: z.string().nullable().describe('The node that last restarted the counter'),
      number: z.string().nullable(),
      label: z.string().nullable(),
    }),
  ),
});
export type NumberingView = z.infer<typeof NumberingView>;

/**
 * What each occurrence of the latest version contributes to the sequences (structure.md,
 * "Numbering"), as the caller is shown it: enough for the renderer to number every caption itself,
 * with the same function the numbering route calls, and to list each with its caption.
 */
/**
 * The text of every component the document places, as the caller is shown it (interface slice 9):
 * each occurrence and the version it resolved to - null exactly where the contributions route answers
 * null - and each such version once, with its content.
 */
export const DocumentTextsView = z.object({
  document: z.string(),
  version: z.object({ id: z.string(), number: z.string() }),
  occurrences: z
    .array(
      z.object({
        node: z.string(),
        version: z.string().nullable(),
        mayEdit: z
          .boolean()
          .describe('Whether the caller may edit the component: false where they may not read it'),
        mayComment: z
          .boolean()
          .describe(
            'Whether the caller may start and answer threads on the component: false where they may not read it',
          ),
        maySuggest: z
          .boolean()
          .describe(
            'Whether the caller may suggest a change to the component: false where they may not read it',
          ),
        pendingSuggestions: z
          .int()
          .nonnegative()
          .describe(
            'How many suggestions wait on the component: 0 where the caller may not read it',
          ),
        revision: z
          .int()
          .positive()
          .optional()
          .describe(
            'For a reference tracking the latest approved revision, which revision it shows (CNT-163); absent where none is approved',
          ),
        pastReview: z
          .boolean()
          .optional()
          .describe(
            "True where the component's review-by day has passed (LIF-018); absent otherwise, or where the caller may not read it",
          ),
        overrides: z
          .array(
            z.object({
              block: z.string(),
              text: z.array(z.record(z.string(), z.unknown())),
              stale: z
                .boolean()
                .describe(
                  'Whether its paragraph has changed or gone since: then it is not applied',
                ),
            }),
          )
          .optional()
          .describe(
            "This document's local overrides of the component's paragraphs (REU-011): each paragraph's text here, applied where it is not stale; absent where none, or where the caller may not read the component",
          ),
        moved: z
          .object({ id: z.string(), number: z.string() })
          .optional()
          .describe(
            "For a reference tracking the latest approved revision, the version the document's last publication carried, where a newer revision is approved since (LIF-041)",
          ),
        lock: Lock.nullable().describe(
          'Who holds the component now and until when: null where nobody does, or where the caller may not read it',
        ),
        line: z
          .object({ id: z.string(), name: z.string() })
          .optional()
          .describe(
            "The divergent line the version shown is on (LIF-046), served by the document's scope; absent for the main line",
          ),
        newer: z
          .object({ id: z.string(), number: z.string().describe('`revision.version`, as `0.3`') })
          .optional()
          .describe(
            "The component's latest version, where the reference is pinned to an earlier one and the caller may read the component; absent otherwise",
          ),
      }),
    )
    .describe(
      'Each component reference, in outline order, and the version it resolved to: null where the ' +
        'caller may not read the component, where it waits on revisions, or where its content does not read',
    ),
  versions: z
    .array(
      z.object({
        id: z.string(),
        number: z.string().describe('`revision.version`, as `0.2`'),
        content: z.record(z.string(), z.unknown()).describe("The version's content document"),
      }),
    )
    .describe(
      'Each version an occurrence resolved to, once, however many occurrences name it, with its number',
    ),
});
export type DocumentTextsView = z.infer<typeof DocumentTextsView>;

export const ContributionsView = z.object({
  document: z.string(),
  version: z.object({ id: z.string(), number: z.string() }),
  occurrences: z
    .array(z.object({ node: z.string(), version: z.string().nullable() }))
    .describe(
      'Each component reference, in outline order, and the component version it resolved to: null ' +
        'where the caller may not read the component, where it waits on revisions, or where its ' +
        'content does not read, and what it contributes is then not known',
    ),
  versions: z
    .array(
      z.object({
        id: z.string(),
        contributions: z.array(
          z.object({
            block: z.string(),
            sequence: z.string(),
            numbered: z.boolean(),
            caption: z
              .string()
              .nullable()
              .describe("A figure's or a table's caption; null for anything else"),
          }),
        ),
      }),
    )
    .describe(
      'What each version an occurrence resolved to contributes, in document order, each once however ' +
        'many occurrences name it',
    ),
});
export type ContributionsView = z.infer<typeof ContributionsView>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const notFound = {
  description: 'No such document in this environment, or none the caller may read',
  schema: ErrorBody,
} as const;

/** Creating, finding, opening and restructuring documents (structure.md, "Routes"). */
export const documentRoutes = {
  listDocuments: {
    operationId: 'listDocuments',
    method: 'GET',
    path: '/v1/documents',
    summary: 'The documents the caller may read, a page at a time',
    tenantScoped: true,
    access: { check: 'session' },
    query: DocumentListQuery,
    responses: {
      200: { description: 'A page of documents', schema: DocumentList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
    },
  },
  createDocument: {
    operationId: 'createDocument',
    method: 'POST',
    path: '/v1/spaces/{space}/documents',
    summary:
      "Create a document in this space, at version 0.1: an empty outline, or its template's starting one",
    tenantScoped: true,
    access: { check: 'permission', permission: 'create', target: { space: 'space' } },
    params: SpaceParams,
    body: CreateDocumentBody,
    responses: {
      // 200, not 201, for the reason createComponent gives: a permission-checked handler cannot set
      // a status, so nothing is sent before its transaction commits.
      200: { description: 'Created, at version 0.1', schema: CreatedDocumentView },
      400: {
        description:
          'The title, language or direction is not one an outline accepts; ' +
          '`template_unresolved`: a theme, layout, schema or field the template names does not ' +
          'resolve, or a component it requires or a query its bindings name is not there for the ' +
          'caller to read; `acknowledgement_required`: a query a required component holds runs as the ' +
          'caller and `sharesOwnView` was not sent; `parameter_invalid`: a required parameter has no value, or a value does not fit ' +
          'its parameter or the field it seeds; `parameter_unknown`: a value for a parameter the ' +
          'template does not declare, or any for a blank document; or `parameter_unused`, ' +
          "`parameter_field`: the template's parameters no longer fit its fields. Nothing is made",
        schema: TemplateRefusal,
      },
      401: unauthenticated,
      403: {
        description: 'The caller may read the space but may not create in it',
        schema: ErrorBody,
      },
      404: {
        description:
          'No such space in this environment, or none the caller may read; or no such template, or ' +
          'none the caller may read',
        schema: ErrorBody,
      },
      409: {
        description: `${SPACE_ARCHIVED}; or \`creation_failed\`: a query a required component holds failed, each named in \`failures\`, and nothing is made (TPL-024)`,
        schema: CreationRefusal,
      },
      503: {
        description:
          "`connector_unavailable`: the template's required components run queries and no connector is reachable",
        schema: ErrorBody,
      },
    },
  },
  getDocument: {
    operationId: 'getDocument',
    method: 'GET',
    path: '/v1/documents/{id}',
    summary: 'A document at its latest version, and whether the caller may restructure it',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: DocumentParams,
    responses: {
      200: { description: 'The document', schema: DocumentView },
      401: unauthenticated,
      403: {
        description: 'Never answered: a document the caller may read is one they may open',
        schema: ErrorBody,
      },
      404: notFound,
    },
  },
  getNumbering: {
    operationId: 'getNumbering',
    method: 'GET',
    path: '/v1/documents/{id}/numbering',
    summary: "The latest version's numbering, as the caller is shown it",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: DocumentParams,
    responses: {
      200: { description: 'The numbering table', schema: NumberingView },
      401: unauthenticated,
      403: {
        description: 'Never answered: a document the caller may read is one they may number',
        schema: ErrorBody,
      },
      404: notFound,
    },
  },
  getContributions: {
    operationId: 'getContributions',
    method: 'GET',
    path: '/v1/documents/{id}/contributions',
    summary: 'What each occurrence of the latest version contributes, as the caller is shown it',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: DocumentParams,
    responses: {
      200: { description: 'Each occurrence and its contributions', schema: ContributionsView },
      401: unauthenticated,
      403: {
        description:
          'Never answered: a document the caller may read is one whose contributions they may read',
        schema: ErrorBody,
      },
      404: notFound,
    },
  },
  getDocumentTexts: {
    operationId: 'getDocumentTexts',
    method: 'GET',
    path: '/v1/documents/{id}/texts',
    summary: 'The text of every component the latest version places, as the caller is shown it',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: DocumentParams,
    responses: {
      200: {
        description: 'Each occurrence, and each version it resolved to with its content',
        schema: DocumentTextsView,
      },
      401: unauthenticated,
      403: {
        description:
          'Never answered: a document the caller may read is one whose text they may read, as far as they may read it',
        schema: ErrorBody,
      },
      404: notFound,
    },
  },
  recordDocumentValues: {
    operationId: 'recordDocumentValues',
    method: 'PUT',
    path: '/v1/documents/{id}/values',
    summary: "Write the document's own values, whole, as one version with the outline unchanged",
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: { artifact: 'id' } },
    params: DocumentParams,
    body: DocumentValuesBody,
    responses: {
      200: {
        description: 'Written, or nothing changed: the document at its latest version',
        schema: DocumentView,
      },
      400: {
        description:
          "values_invalid: a value is for a field the document's template does not apply, or does " +
          'not fit its field; values_unresolved: the template no longer resolves; or ' +
          'invalid_request: a body this route does not accept',
        schema: OutlineRefusal,
      },
      401: unauthenticated,
      403: {
        description: 'The caller may read the document but may not edit it',
        schema: ErrorBody,
      },
      404: notFound,
      409: {
        description: 'version_precondition: the document has changed since it was read',
        schema: OutlineRefusal,
      },
    },
  },
  getDocumentParameters: {
    operationId: 'getDocumentParameters',
    method: 'GET',
    path: '/v1/documents/{id}/parameters',
    summary:
      "The document's parameters: what its template declares, their values and their history",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: DocumentParams,
    query: DocumentParametersQuery,
    responses: {
      200: {
        description: 'Its parameters and a page of their history',
        schema: DocumentParametersView,
      },
      400: {
        description: 'A cursor this route did not give out, or a limit outside 1 to 200',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: {
        description:
          'Never answered: a document the caller may read is one whose parameters they may read',
        schema: ErrorBody,
      },
      404: notFound,
    },
  },
  recordDocumentParameters: {
    operationId: 'recordDocumentParameters',
    method: 'PUT',
    path: '/v1/documents/{id}/parameters',
    summary:
      "Write the document's parameters, whole, as one version with its outline and values unchanged",
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: { artifact: 'id' } },
    params: DocumentParams,
    body: DocumentParametersBody,
    responses: {
      200: {
        description: 'Written, or nothing changed: the document at its latest version',
        schema: DocumentView,
      },
      400: {
        description:
          'parameter_invalid: a required parameter has no value, or a value does not fit its ' +
          'parameter; parameter_unknown: a value for a parameter the template does not declare; ' +
          'parameter_fixed: a parameter that may not change was changed; or invalid_request: a body ' +
          'this route does not accept',
        schema: OutlineRefusal,
      },
      401: unauthenticated,
      403: {
        description: 'The caller may read the document but may not edit it',
        schema: ErrorBody,
      },
      404: notFound,
      409: {
        description: 'version_precondition: the document has changed since it was read',
        schema: OutlineRefusal,
      },
    },
  },
  recordDocumentProfile: {
    operationId: 'recordDocumentProfile',
    method: 'PUT',
    path: '/v1/documents/{id}/profile',
    summary: "Write the document's profile, whole, as one version with everything else unchanged",
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: { artifact: 'id' } },
    params: DocumentParams,
    body: DocumentProfileBody,
    responses: {
      200: {
        description: 'Written, or nothing changed: the document at its latest version',
        schema: DocumentView,
      },
      400: {
        description:
          '`profile_invalid`: the profile names an axis or a value the environment does not ' +
          'declare; or `invalid_request`: a body this route does not accept',
        schema: OutlineRefusal,
      },
      401: unauthenticated,
      403: {
        description: 'The caller may read the document but may not edit it',
        schema: ErrorBody,
      },
      404: notFound,
      409: {
        description: 'version_precondition: the document has changed since it was read',
        schema: OutlineRefusal,
      },
    },
  },
  previewPlacement: {
    operationId: 'previewPlacement',
    method: 'GET',
    path: '/v1/documents/{id}/placement',
    summary: "What placing another document's section here would pull in",
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: { artifact: 'id' } },
    params: DocumentParams,
    query: PlacementQuery,
    responses: {
      200: { description: 'The report, placing nothing', schema: PlacementReportView },
      401: unauthenticated,
      403: {
        description: 'The caller may read the document but may not edit it',
        schema: ErrorBody,
      },
      404: {
        description:
          'No such document the caller may edit, or no such section in a document the caller may read',
        schema: ErrorBody,
      },
    },
  },
  placeSection: {
    operationId: 'placeSection',
    method: 'POST',
    path: '/v1/documents/{id}/placement',
    summary: "Place another document's section here, as references under a new section",
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: { artifact: 'id' } },
    params: DocumentParams,
    body: PlacementBody,
    responses: {
      200: { description: 'Placed: the document at its latest version', schema: DocumentView },
      400: {
        description:
          'outline_invalid: the placement does not apply, a component it places is not one the caller may reference, or the template allows no section to be added',
        schema: OutlineRefusal,
      },
      401: unauthenticated,
      403: {
        description: 'The caller may read the document but may not edit it',
        schema: ErrorBody,
      },
      404: {
        description:
          'No such document the caller may edit, or no such section in a document the caller may read',
        schema: ErrorBody,
      },
      409: {
        description:
          "version_precondition: the outline has changed since it was read; source_moved: the section's document has a newer version than the report read",
        schema: OutlineRefusal,
      },
    },
  },
  editOutline: {
    operationId: 'editOutline',
    method: 'POST',
    path: '/v1/documents/{id}/outline',
    summary: 'Apply one operation to the outline, as one version',
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: { artifact: 'id' } },
    params: DocumentParams,
    body: OutlineOperationBody,
    responses: {
      200: {
        description: 'Applied, or nothing changed: the document at its latest version',
        schema: DocumentView,
      },
      400: {
        description:
          'outline_invalid: the operation does not apply to the latest outline; values_invalid: a ' +
          "section's value does not fit; values_unresolved: the document's template no longer " +
          'resolves; or invalid_request: a body this route does not accept',
        schema: OutlineRefusal,
      },
      401: unauthenticated,
      403: {
        description: 'The caller may read the document but may not edit it',
        schema: ErrorBody,
      },
      404: notFound,
      409: {
        description: 'version_precondition: the outline has changed since it was read',
        schema: OutlineRefusal,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
