/**
 * **No words but the catalogue's** (docs/plans/2026-10-26-ui-interface-localisation.md, UI-F): in a
 * folder moved into the catalogue, a sentence a person reads is `words('key')`, never English written
 * in place - JSX text, a user-facing prop's literal, or a literal or template placed in JSX. The
 * folders are listed in `eslint.config.js`, the list growing until it is the whole renderer.
 */

/** Props a person reads or hears. */
const USER_PROPS = new Set([
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'title',
  'placeholder',
  'alt',
  'label',
  'named',
  // A confirmation's words (ConfirmDialog).
  'question',
  'sentence',
  'keep',
  'act',
]);

/** Text with words in it: two letters together, not a code, a path or a symbol. */
const hasWords = (text) => {
  const t = text.trim();
  return /[A-Za-z]{2,}/.test(t) && !/^[a-z0-9_.\-/:#@]+$/.test(t);
};

/** Whether a node is placed in JSX: a child of an element, or a branch of one placed there. */
function inJsx(node) {
  let at = node.parent;
  while (at && (at.type === 'ConditionalExpression' || at.type === 'LogicalExpression')) {
    at = at.parent;
  }
  return at?.type === 'JSXExpressionContainer' && at.parent?.type !== 'JSXAttribute';
}

const literalText = (node) =>
  node.type === 'Literal'
    ? typeof node.value === 'string'
      ? node.value
      : ''
    : node.quasis.map((each) => each.value.cooked ?? '').join(' ');

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Words a person reads come from the catalogue (UI-F)' },
    messages: {
      words: 'Words a person reads come from the catalogue: words(\'{{key}}\'), not "{{text}}".',
    },
    schema: [],
  },
  create(context) {
    const report = (node, text) =>
      context.report({
        node,
        messageId: 'words',
        data: { key: 'area.key', text: text.trim().slice(0, 40) },
      });
    return {
      JSXText(node) {
        if (hasWords(node.value)) report(node, node.value);
      },
      JSXAttribute(node) {
        const name = node.name.type === 'JSXIdentifier' ? node.name.name : '';
        if (!USER_PROPS.has(name) || node.value?.type !== 'Literal') return;
        if (typeof node.value.value === 'string' && hasWords(node.value.value)) {
          report(node.value, node.value.value);
        }
      },
      Literal(node) {
        if (typeof node.value === 'string' && hasWords(node.value) && inJsx(node)) {
          report(node, node.value);
        }
      },
      TemplateLiteral(node) {
        if (hasWords(literalText(node)) && inJsx(node)) report(node, literalText(node));
      },
    };
  },
};
