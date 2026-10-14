import type {
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
  defineWorkflow,
  isArchived,
  listWorkflows,
  moveArtifact,
  workflowStanding,
  workflowVersion,
  type TenantTransaction,
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
export function transitionsOffered(
  standing: WorkflowStanding,
  facts: AccessFacts,
  archived: boolean,
): TransitionView[] {
  if (archived) return [];
  const named = (key: string) =>
    standing.definition.body.states.find((each) => each.key === key)?.name ?? key;
  return standing.transitions
    .filter((each) => decide(each.permission, facts).allowed)
    .map((each) => ({
      key: each.key,
      name: each.name,
      to: { key: each.to, name: named(each.to) },
      reasonRequired: each.reasonRequired,
    }));
}

/** An artifact's state from `workflowStates`, for a list: every component and document has one. */
export function stateOf(
  states: ReadonlyMap<string, { readonly key: string; readonly name: string }>,
  id: string,
): { key: string; name: string } {
  const state = states.get(id);
  if (!state) throw new Error(`${id} has no workflow state`);
  return { ...state };
}

/** A component's or a document's state and the transitions `facts` permit, for its view. */
export async function workflowView(
  trx: TenantTransaction,
  id: string,
  facts: AccessFacts,
): Promise<TransitionAnswer> {
  const standing = await workflowStanding(trx, id);
  if (!standing) throw new Error(`${id} has no workflow state`);
  return {
    state: { ...standing.state },
    transitions: transitionsOffered(standing, facts, await isArchived(trx, id)),
  };
}

/**
 * Workflow definitions, each read and saved on `administer` at the tenant, and moves, each decided on
 * `read` by the route and then on the transition's own permission (the WF1 plan, WF-F and WF-J).
 */
export function workflowHandlers() {
  const moving =
    (kind: 'component' | 'document') =>
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
        may: (permission) => decide(permission, facts).allowed,
      });
      switch (answer.answer) {
        case 'moved':
          return {
            state: { ...answer.standing.state },
            transitions: transitionsOffered(answer.standing, facts, false),
          };
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
  };
}
