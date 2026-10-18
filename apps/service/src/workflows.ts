import type {
  ApprovalBody,
  ApprovalsView,
  GateView,
  TransitionAnswer,
  TransitionBody,
  TransitionParams,
  TransitionView,
  WorkflowDefinitionView,
  DefineWorkflowBody,
  WorkflowsView,
  WorkflowVersionParams,
} from '@alloy-works/api-contract';
import {
  decideGate,
  defineWorkflow,
  isArchived,
  listApprovals,
  listWorkflows,
  moveArtifact,
  workflowStanding,
  workflowVersion,
  type TenantTransaction,
  type UnmetCondition,
  type WorkflowDefinition,
  type WorkflowStanding,
} from '@alloy-works/db';
import { decide, type AccessFacts } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, refusedBy, type Authorised } from './access.js';
import { AppError } from './errors.js';
import { refused } from './wire-codes.js';

/** A definition as the API shows it. */
function definitionView(definition: WorkflowDefinition): WorkflowDefinitionView {
  return {
    kind: definition.kind,
    version: definition.version,
    body: {
      states: definition.body.states.map((each) => ({ ...each })),
      transitions: definition.body.transitions.map((each) => ({ ...each })),
    },
    by: definition.by && { ...definition.by },
    at: definition.at.toISOString(),
  };
}

/**
 * The transitions from where it stands that `facts` permit (WF-G): none for an archived one, which does
 * not move until unarchived (WF-K).
 */
const counted = (count: number, one: string, many: string) =>
  `${count.toLocaleString('en-GB')} ${count === 1 ? one : many}`;

/** What a transition requires and is not met, said in a sentence (LIF-004; WF3-B). */
export function unmetMessage(unmet: readonly UnmetCondition[]): string {
  const parts = unmet.map((each) => {
    const named = each.names.length > 0 ? `: ${each.names.join(', ')}` : '';
    const said = {
      suggestions: () => counted(each.count, 'unresolved suggestion', 'unresolved suggestions'),
      threads: () => counted(each.count, 'open thread', 'open threads'),
      generated: () =>
        counted(
          each.count,
          'generated suggestion waiting to be accepted',
          'generated suggestions waiting to be accepted',
        ),
      bindings: () =>
        counted(each.count, 'data binding not resolved', 'data bindings not resolved'),
      sections: () =>
        `${counted(each.count, 'required section missing', 'required sections missing')}${named}`,
      revisions: () =>
        counted(
          each.count,
          'value revised by hand outstanding',
          'values revised by hand outstanding',
        ),
      components: () =>
        `${counted(each.count, 'component not at an approved revision', 'components not at an approved revision')}${named}`,
      profile: () =>
        `${counted(each.count, 'condition axis not set in the profile', 'condition axes not set in the profile')}${named}`,
    }[each.condition]();
    const unseen =
      each.unreadable === 0
        ? ''
        : ` (${counted(each.unreadable, 'component', 'components')} you may not read, so unchecked)`;
    // Nothing found, but not all of it could be looked at.
    return each.count === 0
      ? `${counted(each.unreadable, 'component', 'components')} you may not read, so not checked for ${each.condition}`
      : `${said}${unseen}`;
  });
  return `Not yet: ${parts.join('; ')}.`;
}

function unmetRefusal(unmet: readonly UnmetCondition[]): AppError {
  return refused(409, 'conditions.unmet', unmetMessage(unmet), { unmet });
}

export function transitionsOffered(
  standing: WorkflowStanding,
  facts: AccessFacts,
  archived: boolean,
): TransitionView[] {
  if (archived) return [];
  const named = (key: string) =>
    standing.definition.body.states.find((each) => each.key === key)?.name ?? key;
  return standing.transitions
    .filter((each) => each.gate === undefined && decide(each.permission, facts).allowed)
    .map((each) => ({
      key: each.key,
      name: each.name,
      to: { key: each.to, name: named(each.to) },
      reasonRequired: each.reasonRequired,
    }));
}

/**
 * Each gate from where it stands, how far it has got, and whether the caller may decide it now: by
 * `approve`, never while archived (WF2-L).
 */
export function gatesOffered(
  standing: WorkflowStanding,
  facts: AccessFacts,
  archived: boolean,
  principalId: string,
): GateView[] {
  const named = (key: string) => ({
    key,
    name: standing.definition.body.states.find((each) => each.key === key)?.name ?? key,
  });
  return standing.gates.map((progress) => {
    const transition = standing.transitions.find((each) => each.key === progress.transition)!;
    const approvedByCaller = progress.approvedBy.includes(principalId);
    const publication = transition.gate!.publication;
    return {
      key: transition.key,
      name: transition.name,
      to: named(transition.to),
      reject: { name: transition.gate!.reject.name, to: named(transition.gate!.reject.to) },
      publication,
      mayPublish: publication === 'permitted' && decide('publish', facts).allowed,
      count: progress.count,
      required: progress.required,
      approvedByCaller,
      mayDecide: !archived && decide(transition.permission, facts).allowed,
    };
  });
}

/** Where it stands, as a view and an answer give it to `principalId`. */
function standingAnswer(
  standing: WorkflowStanding,
  facts: AccessFacts,
  archived: boolean,
  principalId: string,
): TransitionAnswer {
  return {
    state: { ...standing.state },
    transitions: transitionsOffered(standing, facts, archived),
    gates: gatesOffered(standing, facts, archived, principalId),
    revision: standing.revision && {
      number: standing.revision.number,
      versionId: standing.revision.versionId,
      at: standing.revision.at.toISOString(),
    },
  };
}

/** An artifact's state from `workflowStates`, for a list: every component and document has one. */
export function stateOf(
  states: ReadonlyMap<string, { readonly key: string; readonly name: string }>,
  id: string,
): { key: string; name: string } {
  const state = states.get(id);
  if (!state) throw new Error(`${id} has no workflow state`);
  return { key: state.key, name: state.name };
}

/** A component's or a document's state and the transitions `facts` permit, for its view. */
export async function workflowView(
  trx: TenantTransaction,
  id: string,
  facts: AccessFacts,
  principalId: string,
  /** A line's standing (R16-C); the main line's where absent. */
  line?: string,
): Promise<TransitionAnswer> {
  const standing = await workflowStanding(trx, id, line);
  if (!standing) throw new Error(`${id} has no workflow state`);
  return standingAnswer(standing, facts, await isArchived(trx, id), principalId);
}

/**
 * Workflow definitions, each read and saved on `administer` at the tenant, and moves, each decided on
 * `read` by the route and then on the transition's own permission (the WF1 plan, WF-F and WF-J).
 */
export function workflowHandlers() {
  const moving =
    (kind: 'component' | 'document' | 'queryDefinition' | 'prompt') =>
    async (
      request: FastifyRequest,
      { trx, principalId, facts, target }: Authorised,
    ): Promise<TransitionAnswer> => {
      const { id } = request.params as TransitionParams;
      const body = request.body as TransitionBody;
      const answer = await moveArtifact(trx, {
        artifactId: id,
        kind,
        transition: body.transition,
        from: body.from,
        reason: body.reason,
        by: principalId,
        ...(body.line === undefined ? {} : { line: body.line }),
        may: (permission) => decide(permission, facts).allowed,
      });
      switch (answer.answer) {
        case 'moved':
          return standingAnswer(answer.standing, facts, false, principalId);
        case 'conditions.unmet':
          throw unmetRefusal(answer.unmet);
        case 'transition.gated':
          throw refused(
            409,
            'transition.gated',
            'This transition is a gate: its approvers approve or reject it.',
          );
        case 'artifact.missing':
          throw notFound();
        case 'state.moved':
          throw refused(
            409,
            'state.moved',
            `It has moved to ${answer.standing.state.name} since.`,
            {
              state: { key: answer.standing.state.key, name: answer.standing.state.name },
            },
          );
        case 'transition.unknown':
          throw refused(409, 'transition.unknown', 'There is no such transition from its state.');
        case 'artifact.archived':
          throw refused(409, 'artifact.archived', 'It is archived, and moves once unarchived.');
        case 'permission.refused':
          throw refusedBy(
            new AppError(403, 'forbidden', `This needs the ${answer.permission} permission.`),
            decide(answer.permission, facts),
            facts,
            target,
            false,
          );
        case 'reason.required':
          throw refused(400, 'reason.required', 'This transition needs a reason.');
        case 'reason.invalid':
          throw refused(400, 'reason.invalid', 'A reason is at most 2,000 characters.');
      }
    };

  const deciding =
    (kind: 'component' | 'document' | 'queryDefinition' | 'prompt') =>
    async (
      request: FastifyRequest,
      { trx, principalId, facts, target }: Authorised,
    ): Promise<TransitionAnswer> => {
      const { id } = request.params as TransitionParams;
      const body = request.body as ApprovalBody;
      // Asking for a publication is publishing, decided as a publish is (LIF-050).
      if (body.publish === true && !decide('publish', facts).allowed) {
        throw refusedBy(
          new AppError(403, 'forbidden', 'Publishing it needs the publish permission.'),
          decide('publish', facts),
          facts,
          target,
          false,
        );
      }
      const answer = await decideGate(trx, {
        artifactId: id,
        kind,
        transition: body.transition,
        version: body.version,
        decision: body.decision,
        reason: body.reason,
        by: principalId,
        publish: body.publish,
        may: (permission) => decide(permission, facts).allowed,
        ...(body.line === undefined ? {} : { line: body.line }),
      });
      switch (answer.answer) {
        case 'conditions.unmet':
          throw unmetRefusal(answer.unmet);
        case 'baseline.refused':
          throw refused(
            409,
            'gate.baseline_refused',
            answer.refusal.answer === 'baseline.unresolved'
              ? `This gate takes a baseline, and ${answer.refusal.failures.length === 1 ? 'one part' : `${answer.refusal.failures.length} parts`} of the document cannot be published as it stands, so nothing was approved.`
              : 'This gate takes a baseline, and none can be made of the document as it stands, so nothing was approved.',
          );
        case 'approved':
        case 'passed':
        case 'rejected':
          return standingAnswer(answer.standing, facts, false, principalId);
        case 'artifact.missing':
          throw notFound();
        case 'state.moved':
          throw refused(
            409,
            'state.moved',
            `It has moved to ${answer.standing.state.name} since.`,
            {
              state: { key: answer.standing.state.key, name: answer.standing.state.name },
            },
          );
        case 'version.moved':
          throw refused(409, 'version.moved', 'A newer version was saved since. Read it first.');
        case 'transition.unknown':
          throw refused(409, 'transition.unknown', 'There is no such gate from its state.');
        case 'artifact.archived':
          throw refused(409, 'artifact.archived', 'It is archived, and moves once unarchived.');
        case 'approval.given':
          throw refused(409, 'approval.given', 'You have approved it already.');
        case 'approval.author':
          throw refused(
            403,
            'approval.author',
            'You recorded a version of it since its last revision, and this gate needs another approver.',
          );
        case 'permission.refused':
          throw refusedBy(
            new AppError(403, 'forbidden', `This needs the ${answer.permission} permission.`),
            decide(answer.permission, facts),
            facts,
            target,
            false,
          );
        case 'reason.required':
          throw refused(400, 'reason.required', 'A rejection needs a reason.');
        case 'reason.invalid':
          throw refused(400, 'reason.invalid', 'A reason is at most 2,000 characters.');
      }
    };

  const approvals = async (
    request: FastifyRequest,
    { trx }: Authorised,
  ): Promise<ApprovalsView> => {
    const { id } = request.params as TransitionParams;
    return {
      approvals: (await listApprovals(trx, id)).map((each) => ({
        transition: each.transition,
        decision: each.decision,
        reason: each.reason,
        by: { ...each.by },
        at: each.at.toISOString(),
        versionId: each.versionId,
      })),
    };
  };

  return {
    listWorkflows: async (
      _request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<WorkflowsView> => ({
      workflows: (await listWorkflows(trx)).map((each) => ({
        definition: definitionView(each.definition),
        counts: { ...each.counts },
      })),
    }),

    getWorkflowVersion: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<WorkflowDefinitionView> => {
      const { kind, version } = request.params as WorkflowVersionParams;
      const found = await workflowVersion(trx, kind, version);
      if (!found) throw notFound();
      return definitionView(found);
    },

    defineWorkflow: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<WorkflowDefinitionView> => {
      const { kind, basedOn, ...body } = request.body as DefineWorkflowBody;
      const answer = await defineWorkflow(trx, {
        kind,
        body,
        by: principalId,
        ...(basedOn === undefined ? {} : { basedOn }),
      });
      if (answer.answer === 'behind') {
        throw refused(
          409,
          'workflow.behind',
          `Version ${answer.version} was saved since this edit began. Read it again before saving.`,
        );
      }
      if (answer.answer === 'invalid') {
        throw refused(400, 'workflow.invalid', 'This workflow cannot be saved as it is.', {
          problems: answer.problems.map((each) => ({ ...each })),
        });
      }
      return definitionView(answer.definition);
    },

    transitionComponent: moving('component'),
    transitionDocument: moving('document'),
    transitionQueryDefinition: moving('queryDefinition'),
    decideQueryDefinitionGate: deciding('queryDefinition'),
    listQueryDefinitionApprovals: approvals,
    transitionPrompt: moving('prompt'),
    decidePromptGate: deciding('prompt'),
    listPromptApprovals: approvals,
    decideComponentGate: deciding('component'),
    decideDocumentGate: deciding('document'),
    listComponentApprovals: approvals,
    listDocumentApprovals: approvals,
  };
}
