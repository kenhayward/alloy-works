import { z } from 'zod';

/**
 * **A workflow definition** (workflow.md; the WF1 plan, WF-B to WF-E): the states one kind's artifacts
 * may be in and the transitions between them, declared per kind by a tenant administrator and kept as
 * versions. The body is parsed and validated here; who may save one, and where it is kept, is the
 * caller's.
 */

/** The kinds a workflow is declared for, one each (WF-A). */
export const WORKFLOW_KINDS = ['component', 'document'] as const;
export type WorkflowKind = (typeof WORKFLOW_KINDS)[number];

/** What a transition needs on the artifact: editing it, or approving it (WF-C). */
export const TRANSITION_PERMISSIONS = ['edit', 'approve'] as const;
export type TransitionPermission = (typeof TRANSITION_PERMISSIONS)[number];

/** A stable key: lower snake, what search filters on and a transition names. */
const Key = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/u);

/** A name as people read it: trimmed, NFC, no control characters. */
const Name = z
  .string()
  .transform((name) => name.normalize('NFC').trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(80)
      .regex(/^[^\p{Cc}]*$/u),
  );

const State = z.strictObject({
  key: Key,
  name: Name,
  initial: z.boolean().default(false),
  /** Saving an artifact in it starts a draft: moves it to the initial state (WF-F). */
  approved: z.boolean().default(false),
});

/** What a gate may do with a publication as it passes (LIF-050; the WF2 plan, WF2-I). */
export const GATE_PUBLICATIONS = ['none', 'permitted', 'required'] as const;

/**
 * A transition that is a gate (LIF-003; the WF2 plan, WF2-A): it passes once `approvals` distinct
 * approvers approve, none an author where `notAuthor` says so; any one may reject it, with a reason,
 * to `reject.to`; passing designates a revision where `designates` says so, and for a document may
 * take a baseline and request its publication.
 */
const Gate = z.strictObject({
  approvals: z.number().int().min(1).max(10),
  notAuthor: z.boolean().default(false),
  reject: z.strictObject({ name: Name, to: Key }),
  designates: z.boolean().default(true),
  baseline: z.boolean().default(false),
  publication: z.enum(GATE_PUBLICATIONS).default('none'),
});

const Transition = z.strictObject({
  key: Key,
  name: Name,
  from: Key,
  to: Key,
  permission: z.enum(TRANSITION_PERMISSIONS),
  reasonRequired: z.boolean().default(false),
  gate: Gate.optional(),
});

export const workflowBodySchema = z.strictObject({
  states: z.array(State).min(1).max(50),
  transitions: z.array(Transition).max(200),
});
export type WorkflowBody = z.output<typeof workflowBodySchema>;
export type WorkflowState = WorkflowBody['states'][number];
export type WorkflowTransition = WorkflowBody['transitions'][number];
export type WorkflowGate = NonNullable<WorkflowTransition['gate']>;

export type WorkflowRule =
  | 'workflow_invalid'
  | 'key_duplicate'
  | 'initial_not_one'
  | 'initial_approved'
  | 'state_unknown'
  | 'transition_to_itself'
  | 'state_unreachable'
  | 'gate_permission'
  | 'gate_kind'
  | 'gate_publication';

export interface WorkflowProblem {
  readonly rule: WorkflowRule;
  readonly path: string;
  readonly message: string;
}

/**
 * A body as a definition holds it, or why not: keys unique among states and among transitions, one
 * initial state, every transition between two states and never to its own, and every state reachable
 * from the initial one, a gate's rejection among the ways. A gate needs `approve`, rejects to a state,
 * and takes a baseline or a publication only for a document, a publication only with a baseline.
 */
export function parseWorkflowBody(
  input: unknown,
  kind?: WorkflowKind,
): { ok: true; body: WorkflowBody } | { ok: false; problems: WorkflowProblem[] } {
  const parsed = workflowBodySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => ({
        rule: 'workflow_invalid',
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }
  const body = parsed.data;
  const problems: WorkflowProblem[] = [];
  const duplicates = (list: readonly { key: string }[], at: string) => {
    const seen = new Set<string>();
    list.forEach((each, index) => {
      if (seen.has(each.key)) {
        problems.push({
          rule: 'key_duplicate',
          path: `${at}.${index}.key`,
          message: `The key ${each.key} is used twice`,
        });
      }
      seen.add(each.key);
    });
  };
  duplicates(body.states, 'states');
  duplicates(body.transitions, 'transitions');
  const initial = body.states.filter((each) => each.initial);
  if (initial.length !== 1) {
    problems.push({
      rule: 'initial_not_one',
      path: 'states',
      message: 'Exactly one state is initial',
    });
  }
  body.states.forEach((each, index) => {
    // A save of an approved artifact moves it to the initial state (WF-F), so that one never counts.
    if (each.initial && each.approved) {
      problems.push({
        rule: 'initial_approved',
        path: `states.${index}`,
        message: 'The initial state cannot count as approved',
      });
    }
  });
  const keys = new Set(body.states.map((each) => each.key));
  body.transitions.forEach((each, index) => {
    for (const end of ['from', 'to'] as const) {
      if (!keys.has(each[end])) {
        problems.push({
          rule: 'state_unknown',
          path: `transitions.${index}.${end}`,
          message: `No state has the key ${each[end]}`,
        });
      }
    }
    if (each.from === each.to) {
      problems.push({
        rule: 'transition_to_itself',
        path: `transitions.${index}`,
        message: 'A transition moves to another state',
      });
    }
    const gate = each.gate;
    if (gate === undefined) return;
    const at = `transitions.${index}`;
    if (each.permission !== 'approve') {
      problems.push({
        rule: 'gate_permission',
        path: `${at}.permission`,
        message: 'A gate is taken by approvers, with the approve permission',
      });
    }
    if (!keys.has(gate.reject.to)) {
      problems.push({
        rule: 'state_unknown',
        path: `${at}.gate.reject.to`,
        message: `No state has the key ${gate.reject.to}`,
      });
    }
    for (const what of ['baseline', 'publication'] as const) {
      const asked = what === 'baseline' ? gate.baseline : gate.publication !== 'none';
      if (asked && kind !== undefined && kind !== 'document') {
        problems.push({
          rule: 'gate_kind',
          path: `${at}.gate.${what}`,
          message: `Only a document's gate takes a ${what}`,
        });
      }
    }
    if (gate.publication !== 'none' && !gate.baseline) {
      problems.push({
        rule: 'gate_publication',
        path: `${at}.gate.publication`,
        message: 'An approved publication is made from the baseline the gate takes',
      });
    }
  });
  if (problems.length === 0) {
    const reached = new Set([initial[0]!.key]);
    for (let grew = true; grew;) {
      grew = false;
      for (const each of body.transitions) {
        for (const to of [each.to, each.gate?.reject.to]) {
          if (to !== undefined && reached.has(each.from) && !reached.has(to)) {
            reached.add(to);
            grew = true;
          }
        }
      }
    }
    body.states.forEach((each, index) => {
      if (!reached.has(each.key)) {
        problems.push({
          rule: 'state_unreachable',
          path: `states.${index}`,
          message: `No transition reaches ${each.key} from the initial state`,
        });
      }
    });
  }
  return problems.length === 0 ? { ok: true, body } : { ok: false, problems };
}

/**
 * Every tenant's version 1, for each kind (WF-C): Return and Approve need `approve`, so whoever
 * reviews does both and an editor alone cannot approve.
 */
export const SEED_WORKFLOW_1: WorkflowBody = {
  states: [
    { key: 'draft', name: 'Draft', initial: true, approved: false },
    { key: 'in_review', name: 'In review', initial: false, approved: false },
    { key: 'approved', name: 'Approved', initial: false, approved: true },
  ],
  transitions: [
    {
      key: 'submit',
      name: 'Submit',
      from: 'draft',
      to: 'in_review',
      permission: 'edit',
      reasonRequired: false,
    },
    {
      key: 'return',
      name: 'Return',
      from: 'in_review',
      to: 'draft',
      permission: 'approve',
      reasonRequired: true,
    },
    {
      key: 'approve',
      name: 'Approve',
      from: 'in_review',
      to: 'approved',
      permission: 'approve',
      reasonRequired: false,
    },
    {
      key: 'reopen',
      name: 'Reopen',
      from: 'approved',
      to: 'draft',
      permission: 'edit',
      reasonRequired: true,
    },
  ],
};

/**
 * The seed's version 2 (the WF2 plan, WF2-B): Approve a gate of one approver, not an author, rejecting
 * to Draft as Return and designating a revision; Return no transition of its own.
 */
export const SEED_WORKFLOW: WorkflowBody = {
  states: SEED_WORKFLOW_1.states,
  transitions: [
    SEED_WORKFLOW_1.transitions[0]!,
    {
      ...SEED_WORKFLOW_1.transitions[2]!,
      gate: {
        approvals: 1,
        notAuthor: true,
        reject: { name: 'Return', to: 'draft' },
        designates: true,
        baseline: false,
        publication: 'none',
      },
    },
    SEED_WORKFLOW_1.transitions[3]!,
  ],
};

/** The initial state of a body that parsed. */
export function initialState(body: WorkflowBody): WorkflowState {
  const found = body.states.find((each) => each.initial);
  if (!found) throw new Error('A workflow definition has one initial state');
  return found;
}

/**
 * The definition a move from `state` is decided under (WF-E): the newest wherever it has the state, so
 * a tightened permission applies at once; else the one the artifact last moved under.
 */
export function decidingDefinition<D extends { readonly body: WorkflowBody }>(
  newest: D,
  recorded: D,
  state: string,
): D {
  return newest.body.states.some((each) => each.key === state) ? newest : recorded;
}

/** The transitions a body declares from `state`, in its order. */
export function transitionsFrom(body: WorkflowBody, state: string): WorkflowTransition[] {
  return body.transitions.filter((each) => each.from === state);
}
