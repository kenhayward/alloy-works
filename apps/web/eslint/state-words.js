/**
 * **A state of content is shown only through `Lozenge`** (ADR-0081; docs/interface/lifecycle-states.md).
 * `Lozenge.tsx` reads the `states.*` keys and nothing else does; a kind is never drawn by hand; a
 * workflow state's name is never placed as bare text; and a state's word never goes in a `Chip`.
 * `lozenge-guard.test.ts` holds `KINDS` to `LOZENGE_KINDS`.
 */
export const KINDS = [
  'draft',
  'beingEdited',
  'returned',
  'inReview',
  'inApproval',
  'approved',
  'effective',
  'published',
  'changedSince',
  'notApproved',
  'pastReview',
  'onHold',
  'released',
  'superseded',
  'current',
  'archived',
  'retired',
  'neverPublished',
  'notYoursToRead',
  'diverged',
  'pending',
  'accepted',
  'rejected',
  'withdrawn',
  'resolved',
  'notStarted',
  'inProgress',
  'complete',
  'closed',
  'untranslated',
  'machineDrafted',
  'inTranslation',
  'translated',
  'outOfDate',
  'neverResolved',
  'changedSinceResolved',
  'failed',
  'revisionWaiting',
  'definitionChanged',
  'revisedByHand',
  'changedSincePublished',
  'holding',
  'retracted',
  'corrected',
  'state',
];

const STATE_KIND = new Set(KINDS);

/** The name of the JSX element a node stands in, if any. */
function enclosingElement(node) {
  for (let at = node.parent; at; at = at.parent) {
    if (at.type === 'JSXElement') return at.openingElement.name.name;
  }
  return undefined;
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'A state of content is shown only through Lozenge (ADR-0081)' },
    messages: {
      key: "'{{key}}' is read only by Lozenge.tsx: show <Lozenge kind=... />, or name it with stateWord().",
      kind: 'A state is drawn by Lozenge alone: <Lozenge kind="{{kind}}" />, not data-kind by hand.',
      name: 'A workflow state is shown by <StateLozenge state={...} />, not its name as bare text.',
      chip: 'A state goes in a Lozenge, not a Chip.',
    },
    schema: [],
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value === 'string' && /^states\.[a-z-]+$/.test(node.value)) {
          context.report({ node, messageId: 'key', data: { key: node.value } });
        }
      },
      JSXAttribute(node) {
        if (node.name.name !== 'data-kind') return;
        const value = node.value?.type === 'Literal' ? node.value.value : undefined;
        if (typeof value === 'string' && STATE_KIND.has(value)) {
          context.report({ node, messageId: 'kind', data: { kind: value } });
        }
      },
      MemberExpression(node) {
        const owner = node.object.type === 'MemberExpression' ? node.object.property : node.object;
        if (
          node.property.name === 'name' &&
          owner.name === 'state' &&
          node.parent.type === 'JSXExpressionContainer' &&
          node.parent.parent.type === 'JSXElement'
        ) {
          context.report({ node, messageId: 'name' });
        }
      },
      CallExpression(node) {
        if (node.callee.name === 'stateWord' && enclosingElement(node) === 'Chip') {
          context.report({ node, messageId: 'chip' });
        }
      },
    };
  },
};
