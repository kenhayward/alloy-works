import { Citation, REQUIREMENT_ID, RESERVED_AREA, validate } from '../model.js';

/**
 * A test title, however the formatter wrapped it. Matches `describe(`, `it(`, `test(` and their
 * modifiers, then the first string literal, in any of the three quote styles. The lazy body with an
 * escape alternative is what lets a title span lines without swallowing the rest of the file.
 */
const TITLE = /\b(?:describe|it|test)(?:\.\w+)*\s*\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;

/** `rule: 'IAM-043'` in a refusal payload - the product citing the requirement it is enforcing. */
const RULE = /\brule:\s*(['"`])([A-Z]{3}-\d{3})\1/g;

/** Word-bounded so that `ADR-0013` is not read as `ADR-001`. */
const IDENTIFIER = /\b[A-Z]{3}-\d{3}\b/g;

const lineOf = (text: string, index: number): number => text.slice(0, index).split(/\r?\n/).length;

/**
 * A test file's text to the requirements it names. Takes text rather than a path, so its tests are
 * template literals.
 *
 * Only a title or a `rule:` field counts. An identifier in a comment, or in ordinary code, is a
 * mention - and mentioning a requirement is not claiming to verify it. That distinction is why the
 * honest count of cited requirements in this repository is smaller than a grep suggests.
 */
export function parseCitations(file: string, text: string): Citation[] {
  const found = new Map<string, Citation>();

  // One citation per identifier per kind per file. Two tests in the same file naming the same
  // requirement in their titles are one fact about that file, and the first one's line is the useful
  // one to report. A citation from a different file is a different fact and gets its own row,
  // because parseCitations is called once per file.
  const add = (id: string, index: number, kind: 'title' | 'rule'): void => {
    if (id.slice(0, 3) === RESERVED_AREA) return;
    if (!REQUIREMENT_ID.test(id)) return;
    const key = `${id}:${kind}`;
    if (found.has(key)) return;
    const line = lineOf(text, index);
    found.set(key, validate(Citation, { id, file, line, kind }, `${file}:${line}`));
  };

  for (const match of text.matchAll(TITLE)) {
    const title = match[2] ?? '';
    // The title body ends one character before the end of the whole match, which is the closing
    // quote. That gives the title's absolute offset exactly, without searching for it - and searching
    // would be wrong, since the same text can appear earlier in the match.
    const titleStart = match.index + match[0].length - 1 - title.length;
    for (const identifier of title.matchAll(IDENTIFIER)) {
      add(identifier[0], titleStart + identifier.index, 'title');
    }
  }

  for (const match of text.matchAll(RULE)) {
    add(match[2]!, match.index, 'rule');
  }

  return [...found.values()].sort((left, right) =>
    left.id === right.id ? left.kind.localeCompare(right.kind) : left.id.localeCompare(right.id),
  );
}
