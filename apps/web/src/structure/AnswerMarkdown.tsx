import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { createElement, type ReactNode } from 'react';

/** HTML stays text, no bare address becomes a link, and quotation marks are the model's own. */
const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });

const CITATION = /\[\[([0-9a-f-]{36})#([A-Za-z0-9_-]{1,64})\]\]/g;
/** A citation held out of the parse in private-use marks, so no Markdown rule reads inside it. */
const HELD = /\uE000(\d+)\uE001/g;

/** The elements a token may become; any other is its content alone. */
const TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'strong',
  'em',
  's',
  'hr',
  'code',
  'pre',
  'br',
]);

type Cite = (component: string, block: string, key: string) => ReactNode;

/**
 * The model's answer as formatted text (issue #857): its Markdown parsed to tokens and each token
 * made a React element from a fixed set, so nothing it wrote becomes HTML, a link or an image. A
 * heading sits under the panel's own, two levels down; each citation is what `cite` gives for it.
 */
export function AnswerMarkdown({ text, cite }: { text: string; cite: Cite }): ReactNode {
  const held: { component: string; block: string }[] = [];
  const source = text.replace(CITATION, (_, component: string, block: string) => {
    held.push({ component, block });
    return `\uE000${held.length - 1}\uE001`;
  });
  let next = 0;
  const key = () => String(next++);

  const words = (value: string): ReactNode[] =>
    value.split(HELD).map((part, index) => {
      if (index % 2 === 0) return part;
      const at = held[Number(part)]!;
      return cite(at.component, at.block, key());
    });

  const build = (tokens: readonly Token[]): ReactNode[] => {
    const stack: { tag: string; props: Record<string, unknown>; children: ReactNode[] }[] = [
      { tag: '', props: {}, children: [] },
    ];
    const add = (node: ReactNode | ReactNode[]) =>
      stack.at(-1)!.children.push(...(Array.isArray(node) ? node : [node]));
    for (const token of tokens) {
      const tag =
        token.tag.startsWith('h') && /^h[1-6]$/.test(token.tag)
          ? `h${Math.min(6, Number(token.tag[1]) + 2)}`
          : token.tag;
      // A tight list's paragraphs are hidden: their words stand in the item itself.
      const shown = TAGS.has(tag) && !token.hidden;
      if (token.nesting === 1) {
        const start = token.attrGet('start');
        stack.push({
          tag: shown ? tag : '',
          props: start === null ? {} : { start: Number(start) },
          children: [],
        });
      } else if (token.nesting === -1) {
        const frame = stack.pop()!;
        add(
          frame.tag === ''
            ? frame.children
            : createElement(frame.tag, { key: key(), ...frame.props }, ...frame.children),
        );
      } else if (token.type === 'inline') {
        add(build(token.children ?? []));
      } else if (
        token.type === 'text' ||
        token.type === 'html_inline' ||
        token.type === 'html_block'
      ) {
        add(words(token.content));
      } else if (token.type === 'image') {
        add(words(token.content));
      } else if (token.type === 'code_inline') {
        add(createElement('code', { key: key() }, token.content));
      } else if (token.type === 'fence' || token.type === 'code_block') {
        add(
          createElement(
            'pre',
            { key: key() },
            createElement('code', null, token.content.replace(/\n$/, '')),
          ),
        );
      } else if (token.type === 'softbreak') {
        add('\n');
      } else if (shown) {
        add(createElement(tag, { key: key() }));
      }
    }
    return stack[0]!.children;
  };

  return build(markdown.parse(source, {}));
}
