import { describe, expect, it } from 'vitest';
import {
  decidingDefinition,
  parseWorkflowBody,
  SEED_WORKFLOW,
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
    const parsed = parseWorkflowBody(SEED_WORKFLOW);
    expect(parsed).toEqual({ ok: true, body: SEED_WORKFLOW });
    expect(SEED_WORKFLOW.states.map((each) => each.key)).toEqual([
      'draft',
      'in_review',
      'approved',
    ]);
    expect(SEED_WORKFLOW.states.filter((each) => each.initial).map((each) => each.key)).toEqual([
      'draft',
    ]);
    expect(SEED_WORKFLOW.states.filter((each) => each.approved).map((each) => each.key)).toEqual([
      'approved',
    ]);
    expect(
      SEED_WORKFLOW.transitions.map(({ key, from, to, permission, reasonRequired }) => [
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
  const recorded = { id: 'r', body: SEED_WORKFLOW };
  const tightened = {
    id: 'n',
    body: {
      states: SEED_WORKFLOW.states.filter((each) => each.key !== 'in_review'),
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
    expect(transitionsFrom(SEED_WORKFLOW, 'in_review').map((each) => each.key)).toEqual([
      'return',
      'approve',
    ]);
    expect(transitionsFrom(tightened.body, 'approved')[0]?.permission).toBe('approve');
  });
});
