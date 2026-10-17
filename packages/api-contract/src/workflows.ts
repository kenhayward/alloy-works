import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody } from './schemas.js';

/** A workflow's kind: one for components, one for documents (the WF1 plan, WF-A). */
export const WorkflowKindParam = z.enum(['component', 'document', 'queryDefinition']);

const Key = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/u)
  .describe('A stable key: lower case, digits and underscores, starting with a letter');

const Name = z.string().min(1).max(80).describe('As people read it; trimmed and NFC');

/** A state a kind's artifacts may be in. */
const WorkflowStateBody = z.strictObject({
  key: Key,
  name: Name,
  initial: z
    .boolean()
    .default(false)
    .describe('Where a new one starts, and a save of an approved one returns to; exactly one'),
  approved: z
    .boolean()
    .default(false)
    .describe('Counts as approved: saving one in it moves it to the initial state'),
});

/** A transition that is a gate (the WF2 plan, WF2-A). */
const GateBody = z.strictObject({
  approvals: z.int().min(1).max(10).describe('How many distinct approvers it needs'),
  notAuthor: z
    .boolean()
    .default(false)
    .describe('Whether whoever recorded a version since the last revision is refused'),
  reject: z
    .strictObject({ name: Name, to: Key.describe('The state a rejection returns it to') })
    .describe('What a rejection is called, and where it returns'),
  designates: z.boolean().default(true).describe('Whether passing it designates a revision'),
  baseline: z
    .boolean()
    .default(false)
    .describe("A document's gate: whether passing takes a baseline"),
  publication: z
    .enum(['none', 'permitted', 'required'])
    .default('none')
    .describe("A document's gate: whether passing may, or must, request an approved publication"),
});

/** What a transition may require (LIF-004; the WF3 plan, WF3-A). */
const TransitionCondition = z
  .enum(['suggestions', 'threads', 'bindings', 'sections', 'revisions', 'components', 'profile'])
  .describe(
    'suggestions: none unresolved; threads: none open; bindings: every binding resolved and current; sections: no required section missing; revisions: no value revised by hand outstanding; components: every component assembled at an approved revision; profile: every condition axis the kept content depends on set in the document profile',
  );

const WorkflowTransitionBody = z.strictObject({
  key: Key,
  name: Name,
  from: Key.describe('The state it moves from, by key'),
  to: Key.describe('The state it moves to, by key; never the one it moves from'),
  permission: z
    .enum(['edit', 'approve'])
    .describe('What the caller needs on the component or document to take it'),
  reasonRequired: z
    .boolean()
    .default(false)
    .describe('Whether taking it needs a reason, recorded with it'),
  gate: GateBody.optional().describe(
    'Present for a gate: decided by approvers, never taken as a move; its permission is approve',
  ),
  requires: z
    .array(TransitionCondition)
    .max(6)
    .optional()
    .describe(
      "What must be met to take it, or for each approval at a gate (LIF-004): a component's may require suggestions and threads, a document's any; each at most once",
    ),
});

/** What a review date passing unmet does, and how long before it its owner is prompted (LIF-059). */
const ReviewPolicyBody = z
  .strictObject({
    remind: z.int().min(0).max(365).describe('Days before the review-by day its owner is prompted'),
    lapse: z
      .discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('visibility') }),
        z.strictObject({ kind: z.literal('move'), to: Key.describe('The state it moves to') }),
        z.strictObject({ kind: z.literal('escalate'), to: z.uuid().describe('Who is prompted') }),
      ])
      .describe('What a review day passing unmet does: shown alone, a move, or an escalation'),
  })
  .describe('Absent: 30 days, and shown alone');

/** A definition's body: every state reachable from the initial one, keys unique. */
export const WorkflowBody = z.strictObject({
  states: z.array(WorkflowStateBody).min(1).max(50),
  transitions: z.array(WorkflowTransitionBody).max(200),
  review: ReviewPolicyBody.optional(),
});
export type WorkflowBody = z.input<typeof WorkflowBody>;

const Principal = z.object({
  id: z.string(),
  name: z
    .string()
    .nullable()
    .describe('Their display name, or address; null where neither is known'),
});

export const WorkflowDefinitionView = z.object({
  kind: WorkflowKindParam,
  version: z.int().describe('Its version: 1 is the seed, and each save the next'),
  body: z.object({
    states: z.array(
      z.object({ key: z.string(), name: z.string(), initial: z.boolean(), approved: z.boolean() }),
    ),
    transitions: z.array(
      z.object({
        key: z.string(),
        name: z.string(),
        from: z.string(),
        to: z.string(),
        permission: z.enum(['edit', 'approve']),
        reasonRequired: z.boolean(),
        gate: z
          .object({
            approvals: z.int(),
            notAuthor: z.boolean(),
            reject: z.object({ name: z.string(), to: z.string() }),
            designates: z.boolean(),
            baseline: z.boolean(),
            publication: z.enum(['none', 'permitted', 'required']),
          })
          .optional(),
        requires: z.array(TransitionCondition).optional(),
      }),
    ),
    review: ReviewPolicyBody.optional(),
  }),
  by: Principal.nullable().describe('Who saved it; null for the seed'),
  at: z.string().describe('When it was saved'),
});
export type WorkflowDefinitionView = z.infer<typeof WorkflowDefinitionView>;

export const WorkflowsView = z.object({
  workflows: z
    .array(
      z.object({
        definition: WorkflowDefinitionView.describe('The version in force: the newest'),
        counts: z
          .record(z.string(), z.int())
          .describe('How many of the kind, deleted ones aside, are in each state now, by key'),
      }),
    )
    .describe("Each kind's workflow, components first"),
});
export type WorkflowsView = z.infer<typeof WorkflowsView>;

/** A kind's next version: which kind, and its body. */
export const DefineWorkflowBody = WorkflowBody.extend({
  kind: WorkflowKindParam.describe('The kind it is the workflow of'),
  basedOn: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('The version the edit began from; refused if another has been saved since'),
});
export type DefineWorkflowBody = z.infer<typeof DefineWorkflowBody>;

export const WorkflowVersionParams = z.object({
  kind: WorkflowKindParam,
  version: z.coerce.number().int().min(1),
});
export type WorkflowVersionParams = z.infer<typeof WorkflowVersionParams>;

/** A component's or a document's state, as every view of it shows it (WF-G). */
export const WorkflowStateView = z
  .object({ key: z.string(), name: z.string() })
  .describe('Its workflow state now, named by the definition deciding its next move');
export type WorkflowStateView = z.infer<typeof WorkflowStateView>;

/** A component's or a document's own state, on its view and a move's answer (WF-F). */
export const WorkflowStandingView = WorkflowStateView.extend({
  approved: z.boolean().describe('Whether it counts as approved: a save starts a new draft'),
}).describe('Its workflow state now, named by the definition deciding its next move');
export type WorkflowStandingView = z.infer<typeof WorkflowStandingView>;

/** A transition the reader may take now. */
export const TransitionView = z.object({
  key: z.string(),
  name: z.string(),
  to: WorkflowStateView.describe('The state it moves to'),
  reasonRequired: z.boolean(),
});
export type TransitionView = z.infer<typeof TransitionView>;

export const TransitionParams = z.object({ id: z.uuid() });
export type TransitionParams = z.infer<typeof TransitionParams>;

export const TransitionBody = z.strictObject({
  transition: Key.describe('The transition to take, by key'),
  from: Key.describe(
    'The state the caller saw it in: refused, as state_moved, where it has moved since',
  ),
  reason: z
    .string()
    .max(2000)
    .optional()
    .describe('Why, recorded with the move; required where the transition says so'),
});
export type TransitionBody = z.infer<typeof TransitionBody>;

/** A gate from its state, how far it has got, and whether the caller may decide it (WF2-L). */
export const GateView = z.object({
  key: z.string(),
  name: z.string(),
  to: WorkflowStateView.describe('The state it moves to once passed'),
  reject: z
    .object({ name: z.string(), to: WorkflowStateView })
    .describe('What a rejection is called, and the state it returns to'),
  publication: z
    .enum(['none', 'permitted', 'required'])
    .describe(
      'Whether passing it may (permitted) or must (required) request an approved publication of its baseline',
    ),
  mayPublish: z
    .boolean()
    .describe('Where it permits one, whether the caller may ask for it as they approve'),
  count: z.int().min(0).describe('Approvals this round on the current version'),
  required: z.int().min(1).describe('Approvals it needs, each by a distinct person'),
  approvedByCaller: z.boolean().describe('Whether the caller has approved it this round'),
  mayDecide: z.boolean().describe('Whether the caller may approve or reject it now'),
});
export type GateView = z.infer<typeof GateView>;

/** An artifact's latest revision (VER-012, VER-015). */
export const WorkflowRevisionView = z
  .object({ number: z.int().min(1), versionId: z.uuid(), at: z.iso.datetime() })
  .nullable()
  .describe('Its latest revision, a version designated as a gate passed; null for revision 0');
export type WorkflowRevisionView = z.infer<typeof WorkflowRevisionView>;

export const TransitionAnswer = z.object({
  state: WorkflowStandingView,
  transitions: z
    .array(TransitionView)
    .describe('The transitions the caller may take from it now; a gate is decided, not taken'),
  gates: z.array(GateView).describe('Each gate from its state, decided by its approvers'),
  revision: WorkflowRevisionView,
});
export type TransitionAnswer = z.infer<typeof TransitionAnswer>;

/** A component's or document's dates (LIF-015 to LIF-018; the WF5 plan, WF5-A, WF5-H). */
export const DatesView = z
  .object({
    effectiveAt: z.iso
      .datetime({ offset: true })
      .nullable()
      .describe('When a revision approved from now takes effect, with the offset it was set in'),
    reviewBy: z.iso.date().nullable().describe('The day it is to be reviewed by'),
    owner: z
      .object({ id: z.uuid(), name: z.string().nullable() })
      .nullable()
      .describe('Who is prompted to review it'),
    pastReview: z.boolean().describe('Whether its review-by day has passed'),
    effectiveFrom: z.iso
      .datetime()
      .nullable()
      .describe(
        'Where its latest revision is approved to take effect later, when: references take the one before until then',
      ),
  })
  .describe("Its effective and review-by dates, and its review's owner");
export type DatesView = z.infer<typeof DatesView>;

export const DatesBody = z.strictObject({
  effectiveAt: z.iso
    .datetime({ offset: true })
    .nullable()
    .describe(
      'When a revision approved from now takes effect, with the offset of its local time; null for as it is approved',
    ),
  reviewBy: z.iso.date().nullable().describe('The day it is to be reviewed by; null for none'),
  owner: z
    .uuid()
    .nullable()
    .describe('Who is prompted to review it: somebody who may read it; null for nobody'),
});
export type DatesBody = z.infer<typeof DatesBody>;

const ScopeKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

/** A component's or document's scope (LIF-042, LIF-047; the R15 plan, R15-B, R15-E). */
export const ScopeView = z
  .object({
    scope: z
      .array(
        z.object({
          axis: ScopeKey,
          value: ScopeKey,
          party: z
            .object({
              kind: z.enum(['principal', 'group']),
              id: z.uuid(),
              name: z.string().nullable(),
            })
            .nullable()
            .describe('Who must accept a revision before it takes effect in this scope'),
        }),
      )
      .describe(
        'The condition axis values a revision approved from now is effective for; none is everywhere',
      ),
    pending: z
      .array(
        z.object({
          revision: z.int().positive(),
          axis: ScopeKey,
          value: ScopeKey,
          party: z.object({
            kind: z.enum(['principal', 'group']),
            id: z.uuid(),
            name: z.string().nullable(),
          }),
          mayAccept: z.boolean().describe('Whether the caller is the party, or one of the group'),
        }),
      )
      .describe(
        'Each scope value whose newest revision waits on its party: the revision before stays effective there until it is accepted',
      ),
  })
  .describe(
    'The scope a revision approved from now is effective for, and what waits on acceptance',
  );
export type ScopeView = z.infer<typeof ScopeView>;

export const ScopeBody = z.strictObject({
  scope: z
    .array(
      z.strictObject({
        axis: ScopeKey.describe("A condition axis's key"),
        value: ScopeKey.describe('One of its values'),
        party: z
          .strictObject({ kind: z.enum(['principal', 'group']), id: z.uuid() })
          .nullable()
          .describe(
            'A person or group who must accept a revision before it takes effect here: somebody who may read it; null for none',
          ),
      }),
    )
    .max(50)
    .describe('Each axis value once; none for everywhere'),
});
export type ScopeBody = z.infer<typeof ScopeBody>;

export const AcceptanceBody = z.strictObject({
  revision: z.int().positive().describe('The revision accepted, by its number'),
  axis: ScopeKey,
  value: ScopeKey,
});
export type AcceptanceBody = z.infer<typeof AcceptanceBody>;

export const AcceptanceView = z.object({
  revision: z.int().positive(),
  axis: ScopeKey,
  value: ScopeKey,
  accepted: z.literal(true),
});
export type AcceptanceView = z.infer<typeof AcceptanceView>;

export const ApprovalBody = z.strictObject({
  transition: Key.describe('The gate, by its transition key'),
  version: z
    .uuid()
    .describe(
      'The version the approver saw: refused, as version_moved, where it has been replaced since',
    ),
  decision: z.enum(['approved', 'rejected']),
  reason: z
    .string()
    .max(2000)
    .optional()
    .describe('Why it is rejected: required for a rejection, kept with it'),
  publish: z
    .boolean()
    .optional()
    .describe(
      "Where the gate permits a publication and this approval passes it, request one of the gate's baseline; needs publish",
    ),
});
export type ApprovalBody = z.infer<typeof ApprovalBody>;

/** One approval or rejection at a gate (LIF-008, LIF-051). */
export const ApprovalView = z.object({
  transition: z.string(),
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().nullable().describe("A rejection's reason; null for an approval"),
  by: z.object({ id: z.uuid(), name: z.string().nullable() }),
  at: z.iso.datetime(),
  versionId: z.uuid().describe('The version decided'),
});
export type ApprovalView = z.infer<typeof ApprovalView>;

export const ApprovalsView = z.object({
  approvals: z.array(ApprovalView).describe('Every approval and rejection, newest first'),
});
export type ApprovalsView = z.infer<typeof ApprovalsView>;

/** A body refused, each problem by its rule and where. */
export const WorkflowRefusal = ErrorBody.extend({
  problems: z
    .array(z.object({ rule: z.string(), path: z.string(), message: z.string() }))
    .optional()
    .describe('workflow_invalid: each problem, by rule and where in the body'),
});

/** A move refused because it moved since, saying where it is now. */
export const TransitionRefusal = ErrorBody.extend({
  state: WorkflowStateView.optional().describe('state_moved: where it is now'),
  unmet: z
    .array(
      z.object({
        condition: TransitionCondition,
        count: z.int().describe('How many stand in its way'),
        names: z
          .array(z.string())
          .describe('The sections missing, or the components not approved, by title'),
        unreadable: z.int().describe('Components the caller may not read, which leave it unproven'),
      }),
    )
    .optional()
    .describe('conditions_unmet: each condition not met, in the order the transition names them'),
});

const administer = {
  check: 'permission',
  permission: 'administer',
  target: { tenant: true },
} as const;
const read = { check: 'permission', permission: 'read', target: { artifact: 'id' } } as const;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const forbidden = {
  description: 'The caller may not administer this environment',
  schema: ErrorBody,
} as const;

const approvalResponses = (kind: 'component' | 'document' | 'query definition') =>
  ({
    200: { description: 'Decided; where it stands now', schema: TransitionAnswer },
    400: {
      description:
        'reason_required: a rejection needs a reason; reason_invalid: a reason over 2,000 characters',
      schema: ErrorBody,
    },
    401: unauthenticated,
    403: {
      description: `The caller may read the ${kind} but may not approve it, or is one of its authors where the gate refuses them (approval_author)`,
      schema: ErrorBody,
    },
    404: {
      description: `No such ${kind} in this environment, or none the caller may read`,
      schema: ErrorBody,
    },
    409: {
      description:
        'state_moved: it is not at the gate; version_moved: the version was replaced; approval_given: the caller approved it this round; transition_unknown: no such gate; artifact_archived; gate_baseline_refused: the baseline the gate takes cannot be made, so nothing was recorded; conditions_unmet: what the gate requires is not met, so nothing was recorded',
      schema: TransitionRefusal,
    },
  }) as const;

const transitionResponses = (kind: 'component' | 'document' | 'query definition') =>
  ({
    200: { description: 'Moved; where it stands now', schema: TransitionAnswer },
    400: {
      description:
        'reason_required: the transition needs a reason, and none was given; reason_invalid: a reason over 2,000 characters',
      schema: ErrorBody,
    },
    401: unauthenticated,
    403: {
      description: `The caller may read the ${kind} but lacks the permission the transition needs`,
      schema: ErrorBody,
    },
    404: {
      description: `No such ${kind} in this environment, or none the caller may read`,
      schema: ErrorBody,
    },
    409: {
      description: `state_moved: the ${kind} is no longer in the state named, which the answer gives; transition_unknown: no such transition from its state; artifact_archived: an archived ${kind} does not move until unarchived; conditions_unmet: what the transition requires is not met`,
      schema: TransitionRefusal,
    },
    410: { description: `The ${kind} has been deleted`, schema: ErrorBody },
  }) as const;

/** Workflow definitions and moves (workflow.md; the WF1 plan, WF-F and WF-J). */
const editing = {
  check: 'permission',
  permission: 'edit',
  target: { artifact: 'id' },
} as const;

const datesResponses = (kind: 'component' | 'document') =>
  ({
    200: { description: 'Its dates now', schema: DatesView },
    400: {
      description: 'owner_invalid: the owner is nobody who may read it',
      schema: ErrorBody,
    },
    401: unauthenticated,
    403: { description: `The caller may read the ${kind} but may not edit it`, schema: ErrorBody },
    404: {
      description: `No such ${kind} in this environment, or none the caller may read`,
      schema: ErrorBody,
    },
    409: {
      description: `artifact_archived: an archived ${kind} keeps its dates`,
      schema: ErrorBody,
    },
  }) as const;

const scopeResponses = (kind: 'component' | 'document') =>
  ({
    200: { description: 'Its scope now', schema: ScopeView },
    400: {
      description:
        'scope_unknown: an axis or value no condition axis declares; party_invalid: a party nobody who may read it; scope_invalid: an axis value twice',
      schema: ErrorBody,
    },
    401: unauthenticated,
    403: { description: `The caller may read the ${kind} but may not edit it`, schema: ErrorBody },
    404: {
      description: `No such ${kind} in this environment, or none the caller may read`,
      schema: ErrorBody,
    },
    409: {
      description: `artifact_archived: an archived ${kind} keeps its scope`,
      schema: ErrorBody,
    },
  }) as const;

const acceptanceResponses = (kind: 'component' | 'document') =>
  ({
    200: { description: 'Accepted there, so it takes effect there', schema: AcceptanceView },
    401: unauthenticated,
    403: {
      description:
        'acceptance_not_party: the caller is not the person, or a member of the group, who must accept it there',
      schema: ErrorBody,
    },
    404: {
      description: `No such ${kind}, revision, or scope waiting on a party, or none the caller may read`,
      schema: ErrorBody,
    },
  }) as const;

export const workflowRoutes = {
  acceptComponentRevision: {
    operationId: 'acceptComponentRevision',
    method: 'POST',
    path: '/v1/components/{id}/acceptance',
    summary: "Accept a component's revision in a scope",
    tenantScoped: true,
    access: read,
    params: TransitionParams,
    body: AcceptanceBody,
    responses: acceptanceResponses('component'),
  },
  acceptDocumentRevision: {
    operationId: 'acceptDocumentRevision',
    method: 'POST',
    path: '/v1/documents/{id}/acceptance',
    summary: "Accept a document's revision in a scope",
    tenantScoped: true,
    access: read,
    params: TransitionParams,
    body: AcceptanceBody,
    responses: acceptanceResponses('document'),
  },
  setComponentScope: {
    operationId: 'setComponentScope',
    method: 'PUT',
    path: '/v1/components/{id}/scope',
    summary: "Set the scope a component's next revision is effective for",
    tenantScoped: true,
    access: editing,
    params: TransitionParams,
    body: ScopeBody,
    responses: scopeResponses('component'),
  },
  setDocumentScope: {
    operationId: 'setDocumentScope',
    method: 'PUT',
    path: '/v1/documents/{id}/scope',
    summary: "Set the scope a document's next revision is effective for",
    tenantScoped: true,
    access: editing,
    params: TransitionParams,
    body: ScopeBody,
    responses: scopeResponses('document'),
  },
  setComponentDates: {
    operationId: 'setComponentDates',
    method: 'PUT',
    path: '/v1/components/{id}/dates',
    summary: "Set a component's effective and review-by dates",
    tenantScoped: true,
    access: editing,
    params: TransitionParams,
    body: DatesBody,
    responses: datesResponses('component'),
  },
  setDocumentDates: {
    operationId: 'setDocumentDates',
    method: 'PUT',
    path: '/v1/documents/{id}/dates',
    summary: "Set a document's effective and review-by dates",
    tenantScoped: true,
    access: editing,
    params: TransitionParams,
    body: DatesBody,
    responses: datesResponses('document'),
  },
  listWorkflows: {
    operationId: 'listWorkflows',
    method: 'GET',
    path: '/v1/workflows',
    summary: "Each kind's workflow in force, and how many are in each state",
    tenantScoped: true,
    access: administer,
    responses: {
      200: { description: "Each kind's workflow", schema: WorkflowsView },
      401: unauthenticated,
      403: forbidden,
    },
  },
  getWorkflowVersion: {
    operationId: 'getWorkflowVersion',
    method: 'GET',
    path: '/v1/workflows/{kind}/versions/{version}',
    summary: "One version of a kind's workflow, every one kept",
    tenantScoped: true,
    access: administer,
    params: WorkflowVersionParams,
    responses: {
      200: { description: 'The version', schema: WorkflowDefinitionView },
      401: unauthenticated,
      403: forbidden,
      404: { description: 'No such version of that kind', schema: ErrorBody },
    },
  },
  defineWorkflow: {
    operationId: 'defineWorkflow',
    method: 'POST',
    path: '/v1/workflows',
    summary: "Save a kind's workflow as its next version",
    tenantScoped: true,
    access: administer,
    body: DefineWorkflowBody,
    responses: {
      200: {
        description: 'Saved, or the same as the version in force, which changes nothing',
        schema: WorkflowDefinitionView,
      },
      400: {
        description:
          'workflow_invalid: a key used twice, not one initial state, a transition naming no state or moving to its own, or a state no transition reaches from the initial one; each problem named',
        schema: WorkflowRefusal,
      },
      401: unauthenticated,
      403: forbidden,
      409: {
        description: 'workflow_behind: another version was saved since the one the edit began from',
        schema: ErrorBody,
      },
    },
  },
  transitionComponent: {
    operationId: 'transitionComponent',
    method: 'POST',
    path: '/v1/components/{id}/transitions',
    summary: 'Move a component along a workflow transition',
    tenantScoped: true,
    access: read,
    params: TransitionParams,
    body: TransitionBody,
    responses: transitionResponses('component'),
  },
  decideComponentGate: {
    operationId: 'decideComponentGate',
    method: 'POST',
    path: '/v1/components/{id}/approvals',
    summary: 'Approve or reject a component at a gate',
    tenantScoped: true,
    access: read,
    params: TransitionParams,
    body: ApprovalBody,
    responses: approvalResponses('component'),
  },
  decideDocumentGate: {
    operationId: 'decideDocumentGate',
    method: 'POST',
    path: '/v1/documents/{id}/approvals',
    summary: 'Approve or reject a document at a gate',
    tenantScoped: true,
    access: read,
    params: TransitionParams,
    body: ApprovalBody,
    responses: approvalResponses('document'),
  },
  listComponentApprovals: {
    operationId: 'listComponentApprovals',
    method: 'GET',
    path: '/v1/components/{id}/approvals',
    summary: "List a component's approvals and rejections",
    tenantScoped: true,
    access: read,
    params: TransitionParams,
    responses: {
      200: { description: 'Every decision at its gates, newest first', schema: ApprovalsView },
      401: unauthenticated,
      403: { description: 'The caller may not read this component', schema: ErrorBody },
      404: { description: 'No such component the caller may read', schema: ErrorBody },
    },
  },
  listDocumentApprovals: {
    operationId: 'listDocumentApprovals',
    method: 'GET',
    path: '/v1/documents/{id}/approvals',
    summary: "List a document's approvals and rejections",
    tenantScoped: true,
    access: read,
    params: TransitionParams,
    responses: {
      200: { description: 'Every decision at its gates, newest first', schema: ApprovalsView },
      401: unauthenticated,
      403: { description: 'The caller may not read this document', schema: ErrorBody },
      404: { description: 'No such document the caller may read', schema: ErrorBody },
    },
  },
  transitionQueryDefinition: {
    operationId: 'transitionQueryDefinition',
    method: 'POST',
    path: '/v1/query-definitions/{id}/transitions',
    summary: 'Move a query definition along a workflow transition',
    tenantScoped: true,
    access: read,
    params: TransitionParams,
    body: TransitionBody,
    responses: transitionResponses('query definition'),
  },
  decideQueryDefinitionGate: {
    operationId: 'decideQueryDefinitionGate',
    method: 'POST',
    path: '/v1/query-definitions/{id}/approvals',
    summary: 'Approve or reject a query definition at a gate',
    tenantScoped: true,
    access: read,
    params: TransitionParams,
    body: ApprovalBody,
    responses: approvalResponses('query definition'),
  },
  listQueryDefinitionApprovals: {
    operationId: 'listQueryDefinitionApprovals',
    method: 'GET',
    path: '/v1/query-definitions/{id}/approvals',
    summary: "List a query definition's approvals and rejections",
    tenantScoped: true,
    access: read,
    params: TransitionParams,
    responses: {
      200: { description: 'Every decision at its gates, newest first', schema: ApprovalsView },
      401: unauthenticated,
      403: { description: 'The caller may not read this query definition', schema: ErrorBody },
      404: { description: 'No such query definition the caller may read', schema: ErrorBody },
    },
  },
  transitionDocument: {
    operationId: 'transitionDocument',
    method: 'POST',
    path: '/v1/documents/{id}/transitions',
    summary: 'Move a document along a workflow transition',
    tenantScoped: true,
    access: read,
    params: TransitionParams,
    body: TransitionBody,
    responses: transitionResponses('document'),
  },
} as const satisfies Record<string, RouteContract>;
