import { randomBytes } from 'node:crypto';
import {
  admit,
  blockIdentifierFrom,
  type BlockNode,
  type ContentDocument,
} from '@alloy-works/domain';
import { readMarkdown } from '@alloy-works/readers/markdown';

/**
 * Markdown admitted into a component's blocks as pasted text is (G2-D): the assistant's edits, and a
 * new component's first version (the G8 plan, G8-C). A refusal is a sentence, never the Markdown.
 */
export function markdownReader(document: ContentDocument) {
  return (markdown: string): readonly BlockNode[] | string => {
    const reading = readMarkdown(markdown);
    if (!reading.ok) return 'The Markdown could not be read.';
    const admitted = admit(reading.input, {
      document,
      conditionAxes: [],
      newIdentifier: () => blockIdentifierFrom(randomBytes(16)),
    });
    return admitted.ok ? admitted.content : 'The Markdown could not be admitted as content.';
  };
}
