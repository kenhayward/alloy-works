import type { BlockNode } from '../content/model/blocks.js';
import type { ContentDocument } from '../content/model/document.js';
import type { InlineNode } from '../content/model/inline.js';
import { contributionsOf, type Contribution } from '../structure/contributions.js';
import {
  conditions,
  number,
  resolve,
  sectionNumbers,
  type NumberingTable,
} from '../structure/numbering.js';
import type { OutlineDocument, OutlineNode } from '../structure/outline.js';
import type { NumberingScheme } from '../structure/scheme.js';

import type { PublishFailure } from './failures.js';
import { characterProblems, codePointName } from './glyphs.js';
import { publishedLanguage } from './language.js';
import {
  DRAFT_NOTICE,
  PUBLISHING_SCHEMA,
  type PublishedBlock,
  type PublishedDocument,
  type PublishedNode,
} from './published.js';

/**
 * What a publish is assembled from, all of it recorded before the job ran: the document version's
 * outline, the content of the version each occurrence took - **only the occurrences the publisher may
 * read**, keyed by node - the failures the request already found resolving them, the numbering scheme,
 * and which characters the pinned faces can set.
 */
export interface AssembleInput {
  readonly outline: OutlineDocument;
  readonly occurrences: ReadonlyMap<string, ContentDocument>;
  readonly refused: readonly PublishFailure[];
  readonly scheme: NumberingScheme;
  readonly covers: (codePoint: number) => boolean;
}

export type Assembled =
  | { readonly ok: true; readonly document: PublishedDocument; readonly numbering: NumberingTable }
  | { readonly ok: false; readonly failures: readonly PublishFailure[] };

/** The paragraph style the template sets. Every other is `style_missing` until themes (slice 4). */
const BODY = 'body';

const failure = (
  stage: PublishFailure['stage'],
  code: PublishFailure['code'],
  node: string | null,
  block: string | null,
  detail: string | null,
): PublishFailure => ({ stage, code, node, block, detail });

/**
 * One pure function from the recorded inputs to the published document, or to every failure at once
 * (docs/design/publishing.md, "The order"; PUB-052). Its stages run in the order the design states,
 * each over the last one's answer: **resolve** (the request's), **conditions** (REU's, the identity
 * until then), **number** (`number`, over the conditioned outline), **check** (everything the engine
 * would refuse), **project**. It takes no clock and no randomness, and no stage stops at a failure:
 * each records what it found and the next carries on over what remains, skipping only what a failure
 * makes meaningless.
 */
export function assemble(input: AssembleInput): Assembled {
  const failures: PublishFailure[] = [...input.refused];

  // resolve and conditions: what each readable occurrence contributes, then REU's stage (#148).
  const contributions = new Map<string, readonly Contribution[]>();
  for (const [node, content] of input.occurrences)
    contributions.set(node, contributionsOf(content));
  const numbering = number(conditions(resolve(input.outline, contributions)), input.scheme);
  const numbers = sectionNumbers(numbering);

  // check and project: one walk, collecting every failure.
  const refusedNodes = new Set(input.refused.map((each) => each.node));
  const check = (text: string, node: string | null, block: string | null) => {
    for (const { problem, codePoint } of characterProblems(text, input.covers)) {
      failures.push(failure('compose', problem, node, block, codePointName(codePoint)));
    }
  };

  check(input.outline.title, null, null);
  const language = publishedLanguage(input.outline.language);
  if (language === null) {
    failures.push(
      failure('compose', 'language_not_publishable', null, null, input.outline.language),
    );
  }

  /** A block the template can set, or a failure naming what it is. */
  const publishable = (block: BlockNode, node: string): PublishedBlock[] => {
    if (block.type !== 'paragraph') {
      failures.push(failure('compose', 'block_not_publishable', node, block.id, block.type));
      return [];
    }
    if (block.style !== BODY) {
      failures.push(failure('compose', 'style_missing', node, block.id, block.style));
    }
    const runs: { text: string }[] = [];
    for (const inline of block.content) {
      const refusal = unpublishableInline(inline);
      if (refusal !== null) {
        failures.push(failure('compose', 'inline_not_publishable', node, block.id, refusal));
        continue;
      }
      if (inline.type === 'text') {
        check(inline.value, node, block.id);
        runs.push({ text: inline.value });
      }
    }
    return runs.length === 0 ? [] : [{ type: 'paragraph', id: block.id, runs }];
  };

  const project = (node: OutlineNode, depth: number): PublishedNode => {
    const numberText = numbers.get(node.id) ?? null;
    if (numberText !== null) check(numberText, node.id, null);
    const shell = { id: node.id, depth, number: numberText };

    if (node.type === 'section') {
      const title = textOf(node.title);
      if (title === null) {
        failures.push(failure('compose', 'title_not_publishable', node.id, null, null));
      } else {
        check(title, node.id, null);
      }
      const children = node.children.map((child) => project(child, depth + 1));
      return {
        ...shell,
        title: title ?? '',
        language: null,
        direction: null,
        blocks: [],
        children,
      };
    }

    const content = input.occurrences.get(node.id);
    if (content === undefined) {
      // The request recorded why; one it did not is a reference nothing resolved.
      if (!refusedNodes.has(node.id)) {
        failures.push(failure('resolve', 'occurrence_unresolved', node.id, null, null));
      }
      const children = node.children.map((child) => project(child, depth + 1));
      return { ...shell, title: '', language: null, direction: null, blocks: [], children };
    }
    check(content.title, node.id, null);
    // A component in the document's own language is not refused a second time.
    const own = content.language === input.outline.language ? null : content.language;
    const ownLanguage = own === null ? null : publishedLanguage(own);
    if (own !== null && ownLanguage === null) {
      failures.push(failure('compose', 'language_not_publishable', node.id, null, own));
    }
    const blocks = content.content.flatMap((block) => publishable(block, node.id));
    const children = node.children.map((child) => project(child, depth + 1));
    return {
      ...shell,
      title: content.title,
      language: ownLanguage,
      direction: content.direction === input.outline.direction ? null : content.direction,
      blocks,
      children,
    };
  };

  const nodes = input.outline.nodes.map((node) => project(node, 1));
  // A refused document language is already a failure; `language === null` only narrows the type.
  if (failures.length > 0 || language === null) return { ok: false, failures };
  return {
    ok: true,
    numbering,
    document: {
      schema: PUBLISHING_SCHEMA,
      title: input.outline.title,
      language,
      direction: input.outline.direction,
      status: 'draft',
      notice: DRAFT_NOTICE,
      nodes,
    },
  };
}

/** Why an inline cannot be set yet - its node type, or its first mark - or null when it can. */
function unpublishableInline(inline: InlineNode): string | null {
  if (inline.type !== 'text') return inline.type;
  const [mark] = inline.marks;
  return mark === undefined ? null : mark.type;
}

/** A section title's words, where it holds nothing but unmarked text; null otherwise. */
function textOf(title: readonly InlineNode[]): string | null {
  let words = '';
  for (const inline of title) {
    if (inline.type !== 'text' || unpublishableInline(inline) !== null) return null;
    words += inline.value;
  }
  return words;
}
