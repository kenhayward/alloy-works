/**
 * A reference's local overrides on the page (REU-011; the R4 plan, R4-G): what the texts route says of
 * each, and the content the page draws with those that stand applied.
 */
export interface OverrideView {
  readonly block: string;
  readonly text: readonly Record<string, unknown>[];
  /** Its paragraph has changed or gone since: not applied (REU-015). */
  readonly stale: boolean;
}

/** An override as the outline's `set` writes it. */
export interface OverrideBody {
  readonly block: string;
  readonly against: string;
  readonly text: readonly {
    readonly type: 'text';
    readonly value: string;
    readonly marks: readonly unknown[];
  }[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Each override the texts route says of an occurrence, checked rather than trusted. */
export function overridesIn(value: unknown): OverrideView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((each): OverrideView[] =>
    isRecord(each) && typeof each['block'] === 'string' && Array.isArray(each['text'])
      ? [
          {
            block: each['block'],
            text: each['text'] as Record<string, unknown>[],
            stale: each['stale'] === true,
          },
        ]
      : [],
  );
}

/** The content drawn in this document: each override that stands replaces its paragraph's text. */
export function withOverrides(content: unknown, overrides: readonly OverrideView[]): unknown {
  const standing = new Map(
    overrides.filter((each) => !each.stale).map((each) => [each.block, each]),
  );
  if (standing.size === 0 || !isRecord(content) || !Array.isArray(content['content']))
    return content;
  return {
    ...content,
    content: content['content'].map((block) => {
      if (!isRecord(block) || block['type'] !== 'paragraph' || typeof block['id'] !== 'string') {
        return block;
      }
      const override = standing.get(block['id']);
      return override ? { ...block, content: override.text } : block;
    }),
  };
}

/** A component's top-level paragraphs, each by its identifier and its words, as an author reads them. */
export function paragraphsOf(content: unknown): { readonly id: string; readonly text: string }[] {
  if (!isRecord(content) || !Array.isArray(content['content'])) return [];
  return content['content'].flatMap((block) => {
    if (!isRecord(block) || block['type'] !== 'paragraph' || typeof block['id'] !== 'string') {
      return [];
    }
    return [{ id: block['id'], text: wordsOf(block['content']) }];
  });
}

function wordsOf(inline: unknown): string {
  if (!Array.isArray(inline)) return '';
  return inline
    .map((node) =>
      isRecord(node) && node['type'] === 'text' && typeof node['value'] === 'string'
        ? node['value']
        : '',
    )
    .join('');
}
