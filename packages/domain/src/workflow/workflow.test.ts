import { describe, expect, it } from 'vitest';
import {
  decidingDefinition,
  parseWorkflowBody,
  reviewPolicy,
  SEED_WORKFLOW,
  SEED_WORKFLOW_1,
  SEED_TERM_WORKFLOW,
  transitionsFrom,
  type WorkflowBody,
} from './workflow.js';

const state = (key: string, extra: Partial<WorkflowBody['states'][number]> = {}) => ({
  key,
  name: key,
  initial: false,
  approved: false,
  ...extra,
});
const move = (key: string, from: string, to: string) => ({
  key,
  name: key,
  from,
  to,
  permission: 'edit' as const,
  reasonRequired: false,
});

describe('a workflow definition (workflow.md)', () => {
  it('LIF-002 seeds draft, in review and approved, each transition declaring from, to and what it requires', () => {
    const parsed = parseWorkflowBody(SEED_WORKFLOW_1);
    expect(parsed).toEqual({ ok: true, body: SEED_WORKFLOW_1 });
    expect(SEED_WORKFLOW_1.states.map((each) => each.key)).toEqual([
      'draft',
      'in_review',
      'approved',
    ]);
    expect(SEED_WORKFLOW_1.states.filter((each) => each.initial).map((each) => each.key)).toEqual([
      'draft',
    ]);
    expect(SEED_WORKFLOW_1.states.filter((each) => each.approved).map((each) => each.key)).toEqual([
      'approved',
    ]);
    expect(
      SEED_WORKFLOW_1.transitions.map(({ key, from, to, permission, reasonRequired }) => [
        key,
        from,
        to,
        permission,
        reasonRequired,
      ]),
    ).toEqual([
      ['submit', 'draft', 'in_review', 'edit', false],
      ['return', 'in_review', 'draft', 'approve', true],
      ['approve', 'in_review', 'approved', 'approve', false],
      ['reopen', 'approved', 'draft', 'edit', true],
    ]);
  });

  it('LIF-003 LIF-009 LIF-010 seeds version 2 with Approve as a gate: one approver, not an author, rejecting to draft as Return', () => {
    expect(parseWorkflowBody(SEED_WORKFLOW, 'document')).toEqual({ ok: true, body: SEED_WORKFLOW });
    expect(SEED_WORKFLOW.states).toEqual(SEED_WORKFLOW_1.states);
    expect(SEED_WORKFLOW.transitions.map((each) => each.key)).toEqual([
      'submit',
      'approve',
      'reopen',
    ]);
    expect(SEED_WORKFLOW.transitions.find((each) => each.key === 'approve')).toMatchObject({
      permission: 'approve',
      gate: {
        approvals: 1,
        notAuthor: true,
        reject: { name: 'Return', to: 'draft' },
        designates: true,
        baseline: false,
        publication: 'none',
      },
    });
  });

  it('refuses a gate a permission alone could take, one rejecting to no state, and a baseline or publication on a component', () => {
    const gate = (extra: object = {}) => ({
      approvals: 2,
      notAuthor: false,
      reject: { name: 'Return', to: 'draft' },
      designates: true,
      baseline: false,
      publication: 'none',
      ...extra,
    });
    const body = (gated: object, permission: 'edit' | 'approve' = 'approve') => ({
      states: [state('draft', { initial: true }), state('done', { approved: true })],
      transitions: [{ ...move('approve', 'draft', 'done'), permission, gate: gated }],
    });
    expect(parseWorkflowBody(body(gate()), 'component')).toMatchObject({ ok: true });
    expect(parseWorkflowBody(body(gate(), 'edit'), 'component')).toMatchObject({
      ok: false,
      problems: [{ rule: 'gate_permission', path: 'transitions.0.permission' }],
    });
    expect(
      parseWorkflowBody(body(gate({ reject: { name: 'Return', to: 'lost' } })), 'component'),
    ).toMatchObject({
      ok: false,
      problems: [{ rule: 'state_unknown', path: 'transitions.0.gate.reject.to' }],
    });
    expect(parseWorkflowBody(body(gate({ baseline: true })), 'component')).toMatchObject({
      ok: false,
      problems: [{ rule: 'gate_kind', path: 'transitions.0.gate.baseline' }],
    });
    expect(parseWorkflowBody(body(gate({ baseline: true })), 'document')).toMatchObject({
      ok: true,
    });
    expect(parseWorkflowBody(body(gate({ publication: 'required' })), 'document')).toMatchObject({
      ok: false,
      problems: [{ rule: 'gate_publication', path: 'transitions.0.gate.publication' }],
    });
  });

  it('LIF-004 lets a transition require conditions, each once, and only those its kind has', () => {
    const body = (requires: unknown) => ({
      states: [state('draft', { initial: true }), state('done', { approved: true })],
      transitions: [{ ...move('finish', 'draft', 'done'), requires }],
    });
    const all = ['suggestions', 'threads', 'bindings', 'sections', 'revisions', 'components'];
    expect(parseWorkflowBody(body(all), 'document')).toMatchObject({
      ok: true,
      body: { transitions: [{ requires: all }] },
    });
    expect(parseWorkflowBody(body(['suggestions', 'threads']), 'component')).toMatchObject({
      ok: true,
    });
    expect(parseWorkflowBody(body(['threads', 'bindings']), 'component')).toMatchObject({
      ok: false,
      problems: [{ rule: 'condition_kind', path: 'transitions.0.requires.1' }],
    });
    // A complete profile is a document's alone (LIF-065; the R11 plan, R11-G).
    expect(parseWorkflowBody(body(['profile']), 'document')).toMatchObject({ ok: true });
    expect(parseWorkflowBody(body(['threads', 'profile']), 'component')).toMatchObject({
      ok: false,
      problems: [{ rule: 'condition_kind', path: 'transitions.0.requires.1' }],
    });
    // No retracted source cited is a document's alone (LIB-036; the XR plan, XR-H).
    expect(parseWorkflowBody(body(['noRetracted']), 'document')).toMatchObject({ ok: true });
    expect(parseWorkflowBody(body(['noRetracted']), 'component')).toMatchObject({
      ok: false,
      problems: [{ rule: 'condition_kind', path: 'transitions.0.requires.0' }],
    });
    expect(parseWorkflowBody(body(['threads']), 'queryDefinition')).toMatchObject({
      ok: false,
      problems: [{ rule: 'condition_kind', path: 'transitions.0.requires.0' }],
    });
    expect(parseWorkflowBody(body(['threads', 'threads']), 'document')).toMatchObject({
      ok: false,
      problems: [{ rule: 'condition_duplicate', path: 'transitions.0.requires.1' }],
    });
    expect(parseWorkflowBody(body(['tidiness']), 'document')).toMatchObject({ ok: false });
    // A body stored before WF3 has none, and reads as it was.
    const plain = parseWorkflowBody(SEED_WORKFLOW, 'document');
    expect(plain.ok && plain.body).toEqual(SEED_WORKFLOW);
  });

  it("LIB-049 seeds a term's standing as draft, approved and deprecated, and keeps deprecated", () => {
    const parsed = parseWorkflowBody(SEED_TERM_WORKFLOW, 'term');
    expect(parsed.ok && parsed.body.states.map((each) => each.key)).toEqual([
      'draft',
      'approved',
      'deprecated',
    ]);
    // Approving designates a revision, a gate of one approver, not an author.
    expect(
      SEED_TERM_WORKFLOW.transitions.find((each) => each.key === 'approve')?.gate,
    ).toMatchObject({
      approvals: 1,
      notAuthor: true,
      designates: true,
    });
    // Deprecation is read by the state's key, so a term's workflow keeps it, never approved.
    const without = {
      states: [state('draft', { initial: true }), state('approved', { approved: true })],
      transitions: [move('approve', 'draft', 'approved')],
    };
    expect(parseWorkflowBody(without, 'term')).toMatchObject({
      ok: false,
      problems: [{ rule: 'deprecated_required', path: 'states' }],
    });
    expect(parseWorkflowBody(without, 'component')).toMatchObject({ ok: true });
    const approvedDeprecated = {
      states: [...without.states, state('deprecated', { approved: true })],
      transitions: [...without.transitions, move('deprecate', 'approved', 'deprecated')],
    };
    expect(parseWorkflowBody(approvedDeprecated, 'term')).toMatchObject({
      ok: false,
      problems: [{ rule: 'deprecated_required', path: 'states.2' }],
    });
  });

  it('LIF-059 declares what a lapsed review does: visibility alone, a move to a state, or an escalation to a person', () => {
    const body = (review: unknown) => ({ ...SEED_WORKFLOW, review });
    const ada = '11111111-1111-4111-8111-111111111111';
    for (const lapse of [
      { kind: 'visibility' },
      { kind: 'move', to: 'draft' },
      { kind: 'escalate', to: ada },
    ]) {
      expect(parseWorkflowBody(body({ remind: 14, lapse }), 'document')).toMatchObject({
        ok: true,
        body: { review: { remind: 14, lapse } },
      });
    }
    expect(
      parseWorkflowBody(body({ remind: 14, lapse: { kind: 'move', to: 'lost' } })),
    ).toMatchObject({ ok: false, problems: [{ rule: 'state_unknown', path: 'review.lapse.to' }] });
    expect(parseWorkflowBody(body({ remind: 400, lapse: { kind: 'visibility' } })).ok).toBe(false);
    expect(parseWorkflowBody(body({ remind: 7, lapse: { kind: 'escalate', to: 'Ada' } })).ok).toBe(
      false,
    );
    // None declared: 30 days, and visibility alone (ADR-0061).
    expect(reviewPolicy(SEED_WORKFLOW)).toEqual({ remind: 30, lapse: { kind: 'visibility' } });
  });

  it('reaches a state only a rejection leads to', () => {
    const parsed = parseWorkflowBody({
      states: [state('draft', { initial: true }), state('done'), state('rework')],
      transitions: [
        {
          ...move('approve', 'draft', 'done'),
          permission: 'approve',
          gate: {
            approvals: 1,
            notAuthor: false,
            reject: { name: 'Send back', to: 'rework' },
            designates: false,
            baseline: false,
            publication: 'none',
          },
        },
        move('again', 'rework', 'draft'),
      ],
    });
    expect(parsed).toMatchObject({ ok: true });
  });

  it('refuses an initial state that counts as approved, which every save would leave and re-enter', () => {
    const parsed = parseWorkflowBody({
      states: [state('approved', { initial: true, approved: true }), state('draft')],
      transitions: [move('edit', 'approved', 'draft')],
    });
    expect(parsed).toMatchObject({
      ok: false,
      problems: [{ rule: 'initial_approved', path: 'states.0' }],
    });
  });

  it('refuses a body with a duplicate key, by rule', () => {
    const parsed = parseWorkflowBody({
      states: [state('draft', { initial: true }), state('draft')],
      transitions: [],
    });
    expect(parsed).toMatchObject({ ok: false, problems: [{ rule: 'key_duplicate' }] });
    const twice = parseWorkflowBody({
      states: [state('draft', { initial: true }), state('done')],
      transitions: [move('finish', 'draft', 'done'), move('finish', 'done', 'draft')],
    });
    expect(twice).toMatchObject({ ok: false, problems: [{ rule: 'key_duplicate' }] });
  });

  it('refuses a state no transition reaches from the initial one', () => {
    const parsed = parseWorkflowBody({
      states: [state('draft', { initial: true }), state('done'), state('lost')],
      transitions: [move('finish', 'draft', 'done'), move('find', 'lost', 'draft')],
    });
    expect(parsed).toMatchObject({
      ok: false,
      problems: [{ rule: 'state_unreachable', path: 'states.2' }],
    });
  });

  it('refuses no initial state, two, a transition to itself and one naming no state', () => {
    const none = parseWorkflowBody({ states: [state('draft')], transitions: [] });
    expect(none).toMatchObject({ ok: false, problems: [{ rule: 'initial_not_one' }] });
    const two = parseWorkflowBody({
      states: [state('a', { initial: true }), state('b', { initial: true })],
      transitions: [move('go', 'a', 'b')],
    });
    expect(two).toMatchObject({ ok: false, problems: [{ rule: 'initial_not_one' }] });
    const itself = parseWorkflowBody({
      states: [state('a', { initial: true })],
      transitions: [move('stay', 'a', 'a')],
    });
    expect(itself).toMatchObject({ ok: false, problems: [{ rule: 'transition_to_itself' }] });
    const nowhere = parseWorkflowBody({
      states: [state('a', { initial: true })],
      transitions: [move('go', 'a', 'b')],
    });
    expect(nowhere).toMatchObject({ ok: false, problems: [{ rule: 'state_unknown' }] });
  });

  it('refuses a shape it does not know, naming where', () => {
    const parsed = parseWorkflowBody({
      states: [{ key: 'Draft!', name: 'Draft' }],
      transitions: [],
    });
    expect(parsed).toMatchObject({
      ok: false,
      problems: [{ rule: 'workflow_invalid', path: 'states.0.key' }],
    });
  });
});

describe('the definition that decides a move (WF-E)', () => {
  const recorded: { id: string; body: WorkflowBody } = { id: 'r', body: SEED_WORKFLOW_1 };
  const tightened: { id: string; body: WorkflowBody } = {
    id: 'n',
    body: {
      states: SEED_WORKFLOW_1.states.filter((each) => each.key !== 'in_review'),
      transitions: [
        { ...move('approve', 'draft', 'approved'), permission: 'approve' as const },
        { ...move('reopen', 'approved', 'draft'), permission: 'approve' as const },
      ],
    },
  };

  it('LIF-007 is the newest wherever it has the state, else the one the artifact moved under', () => {
    expect(decidingDefinition(tightened, recorded, 'draft')).toBe(tightened);
    expect(decidingDefinition(tightened, recorded, 'in_review')).toBe(recorded);
  });

  it('offers the transitions from a state', () => {
    expect(transitionsFrom(SEED_WORKFLOW_1, 'in_review').map((each) => each.key)).toEqual([
      'return',
      'approve',
    ]);
    expect(transitionsFrom(tightened.body, 'approved')[0]?.permission).toBe('approve');
  });
});
