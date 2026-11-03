/** A comment's parts (TH-B): words, and each person named where they were typed. */
export type Part = { readonly text: string } | { readonly mention: string };

/** A comment as it is written: its text, and which runs of it name somebody, by id. */
export interface Draft {
  readonly text: string;
  readonly mentions: readonly { readonly from: number; readonly to: number; readonly id: string }[];
}

export const EMPTY_DRAFT: Draft = { text: '', mentions: [] };

/** A comment names at most this many, counting each time (`commentPartsSchema`). */
export const MOST_MENTIONS = 20;

/**
 * The text changed to `value`: a mention before or after the change moves with its text, and one the
 * change lands in stops being a mention, its words left as typed.
 */
export function applyEdit(draft: Draft, value: string, caret?: number): Draft {
  const before = draft.text;
  // Where the caret stands says which of two alike characters changed: all after it stood still.
  const mostTail = Math.min(before.length, value.length - (caret ?? 0));
  let tail = 0;
  while (
    tail < mostTail &&
    (caret !== undefined || tail < Math.min(before.length, value.length)) &&
    before[before.length - 1 - tail] === value[value.length - 1 - tail]
  ) {
    tail += 1;
  }
  let start = 0;
  while (
    start < before.length - tail &&
    start < value.length - tail &&
    before[start] === value[start]
  ) {
    start += 1;
  }
  const end = before.length - tail;
  const moved = value.length - before.length;
  return {
    text: value,
    mentions: draft.mentions.flatMap((each) => {
      if (each.to <= start) return [each];
      if (each.from >= end) return [{ ...each, from: each.from + moved, to: each.to + moved }];
      return [];
    }),
  };
}

/** The `@` being typed at the caret and what follows it: at a word's start, on one line. */
export function typedMention(
  draft: Draft,
  caret: number,
): { readonly at: number; readonly query: string } | null {
  const at = draft.text.lastIndexOf('@', caret - 1);
  if (at < 0 || caret === 0) return null;
  const query = draft.text.slice(at + 1, caret);
  if (/[\n@]/.test(query) || query.length > 60) return null;
  if (at > 0 && !/\s/.test(draft.text[at - 1]!)) return null;
  if (draft.mentions.some((each) => at >= each.from && at < each.to)) return null;
  return { at, query };
}

/** Somebody chosen for the `@` at `at`: named there, and the caret left after a space. */
export function chooseMention(
  draft: Draft,
  at: number,
  caret: number,
  person: { readonly id: string; readonly name: string },
): { readonly draft: Draft; readonly caret: number } {
  const said = `@${person.name}`;
  const next = applyEdit(
    draft,
    `${draft.text.slice(0, at)}${said} ${draft.text.slice(caret)}`,
    at + said.length + 1,
  );
  const to = at + said.length;
  return {
    draft: {
      text: next.text,
      mentions: [...next.mentions, { from: at, to, id: person.id }].sort((a, b) => a.from - b.from),
    },
    caret: to + 1,
  };
}

/** Whether there is anything to send: a person named, or words that are not all space. */
export const hasContent = (draft: Draft): boolean =>
  draft.mentions.length > 0 || draft.text.trim() !== '';

/** Words as the service stores them: a pasted tab or other control character is a space. */
const stored = (words: string) => words.replace(/(?!\n)\p{Cc}/gu, ' ');

/** The parts a draft sends, in the order they stand. */
export function toParts(draft: Draft): Part[] {
  const parts: Part[] = [];
  let from = 0;
  for (const each of draft.mentions) {
    if (each.from > from) parts.push({ text: stored(draft.text.slice(from, each.from)) });
    parts.push({ mention: each.id });
    from = each.to;
  }
  if (from < draft.text.length) parts.push({ text: stored(draft.text.slice(from)) });
  return parts;
}

/** A comment's parts as a draft, to edit: each person named where they stood. */
export function fromParts(parts: readonly Part[], nameOf: (id: string) => string): Draft {
  let text = '';
  const mentions: { from: number; to: number; id: string }[] = [];
  for (const part of parts) {
    if ('text' in part) {
      text += part.text;
    } else {
      const said = `@${nameOf(part.mention)}`;
      mentions.push({ from: text.length, to: text.length + said.length, id: part.mention });
      text += said;
    }
  }
  return { text, mentions };
}
