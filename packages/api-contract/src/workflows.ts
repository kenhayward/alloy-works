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
});

/** A definition's body: every state reachable from the initial one, keys unique. */
export const WorkflowBody = z.strictObject({
  states: z.array(WorkflowStateBody).min(1).max(50),
  transitions: z.array(WorkflowTransitionBody).max(200),
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
      }),
    ),
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
        'state_moved: it is not at the gate; version_moved: the version was replaced; approval_given: the caller approved it this round; transition_unknown: no such gate; artifact_archived; gate_baseline_refused: the baseline the gate takes cannot be made, so nothing was recorded; gate_publication_refused: likewise its publication',
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
      description: `state_moved: the ${kind} is no longer in the state named, which the answer gives; transition_unknown: no such transition from its state; artifact_archived: an archived ${kind} does not move until unarchived`,
      schema: TransitionRefusal,
    },
    410: { description: `The ${kind} has been deleted`, schema: ErrorBody },
  }) as const;

/** Workflow definitions and moves (workflow.md; the WF1 plan, WF-F and WF-J). */
export const workflowRoutes = {
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
