import { z } from 'zod';

/**
 * **A workflow definition** (workflow.md; the WF1 plan, WF-B to WF-E): the states one kind's artifacts
 * may be in and the transitions between them, declared per kind by a tenant administrator and kept as
 * versions. The body is parsed and validated here; who may save one, and where it is kept, is the
 * caller's.
 */

/**
 * The kinds a workflow is declared for, one each (WF-A); query definitions since WF2 (DAT-121), prompts
 * since G4 (GEN-045).
 */
export const WORKFLOW_KINDS = ['component', 'document', 'queryDefinition', 'prompt'] as const;
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

/**
 * What a transition may require before it is taken (LIF-004; the WF3 plan, WF3-A): no unresolved
 * suggestions, no open threads, no failed bindings, no missing required sections, no outstanding
 * revisions, and every component assembled at an approved revision.
 */
export const TRANSITION_CONDITIONS = [
  'suggestions',
  'threads',
  'bindings',
  'sections',
  'revisions',
  'components',
  // A complete profile: every axis the kept content is conditioned on set (LIF-065; R11-G).
  'profile',
  // No generated suggestion waiting to be accepted or rejected (GEN-025; the G3 plan, G3-B): a part of
  // `suggestions`, for a tenant that requires reviewed generated content and no more.
  'generated',
  // A finished trial run of the version taken through (GEN-045, GN-F; the G4 plan, G4-E): a prompt's.
  'trial',
] as const;
export type TransitionCondition = (typeof TRANSITION_CONDITIONS)[number];

/**
 * The conditions each kind's transitions may require, each listed, so a condition added for one kind
 * is offered to no other: a query definition has none to require, a prompt its trial alone.
 */
export const CONDITIONS_BY_KIND: Readonly<Record<WorkflowKind, readonly TransitionCondition[]>> = {
  component: ['suggestions', 'threads', 'generated'],
  document: [
    'suggestions',
    'threads',
    'bindings',
    'sections',
    'revisions',
    'components',
    'profile',
    'generated',
  ],
  queryDefinition: [],
  prompt: ['trial'],
};

const Transition = z.strictObject({
  key: Key,
  name: Name,
  from: Key,
  to: Key,
  permission: z.enum(TRANSITION_PERMISSIONS),
  reasonRequired: z.boolean().default(false),
  gate: Gate.optional(),
  /** Absent in a body stored before WF3, and read as requiring nothing. */
  requires: z.array(z.enum(TRANSITION_CONDITIONS)).max(TRANSITION_CONDITIONS.length).optional(),
});

/**
 * What a review date passing unmet does (LIF-059; the WF5 plan, WF5-E): shown alone, a move to a
 * state, or an escalation to a person; and how many days before it the owner is prompted (LIF-017).
 */
const ReviewPolicy = z.strictObject({
  remind: z.number().int().min(0).max(365),
  lapse: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('visibility') }),
    z.strictObject({ kind: z.literal('move'), to: Key }),
    z.strictObject({ kind: z.literal('escalate'), to: z.uuid() }),
  ]),
});
export type ReviewPolicy = z.output<typeof ReviewPolicy>;

export const workflowBodySchema = z.strictObject({
  states: z.array(State).min(1).max(50),
  transitions: z.array(Transition).max(200),
  /** Absent in a body stored before WF5, and read as `reviewPolicy` says. */
  review: ReviewPolicy.optional(),
});

/** A body's review policy, or 30 days and visibility alone where it declares none (ADR-0061). */
export function reviewPolicy(body: WorkflowBody): ReviewPolicy {
  return body.review ?? { remind: 30, lapse: { kind: 'visibility' } };
}
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
  | 'gate_publication'
  | 'condition_kind'
  | 'condition_duplicate'
  | 'trial_required';

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
    const at = `transitions.${index}`;
    (each.requires ?? []).forEach((condition, n) => {
      if (each.requires!.indexOf(condition) !== n) {
        problems.push({
          rule: 'condition_duplicate',
          path: `${at}.requires.${n}`,
          message: `The transition already requires ${condition}`,
        });
      } else if (kind !== undefined && !CONDITIONS_BY_KIND[kind].includes(condition)) {
        problems.push({
          rule: 'condition_kind',
          path: `${at}.requires.${n}`,
          message: `A ${kind}'s transition cannot require ${condition}`,
        });
      }
    });
    // Approving a prompt attests a trial of it (GN-F): no tenant's workflow lifts that (GEN-045).
    if (
      kind === 'prompt' &&
      each.permission === 'approve' &&
      !(each.requires ?? []).includes('trial')
    ) {
      problems.push({
        rule: 'trial_required',
        path: `${at}.requires`,
        message: 'Approving a prompt requires a finished trial run of the version approved',
      });
    }
    const gate = each.gate;
    if (gate === undefined) return;
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
  const lapse = body.review?.lapse;
  if (lapse?.kind === 'move' && !keys.has(lapse.to)) {
    problems.push({
      rule: 'state_unknown',
      path: 'review.lapse.to',
      message: `No state has the key ${lapse.to}`,
    });
  }
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

/**
 * The document seed's version 3 (the WF2 plan, WF2-H, WF2-I): its Approve also takes a baseline, from
 * which its approver may publish an approved publication.
 */
export const SEED_DOCUMENT_WORKFLOW: WorkflowBody = {
  ...SEED_WORKFLOW,
  transitions: SEED_WORKFLOW.transitions.map((each) =>
    each.gate === undefined
      ? each
      : { ...each, gate: { ...each.gate, baseline: true, publication: 'permitted' as const } },
  ),
};

/**
 * The prompt seed's version 2 (0125; the G4 plan, G4-E): the gated seed, its Approve requiring a
 * finished trial run of the version approved (GN-F).
 */
export const SEED_PROMPT_WORKFLOW: WorkflowBody = {
  ...SEED_WORKFLOW,
  transitions: SEED_WORKFLOW.transitions.map((each) =>
    each.gate === undefined ? each : { ...each, requires: ['trial' as const] },
  ),
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
