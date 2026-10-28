import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * **Every dialog walked or named** (the TE plan, TE-G): each renderer file that draws a dialog is
 * walked in `pseudo.test.ts`, a surface naming it as its `dialog`, or named here with why the walk
 * cannot open it. A dialog added later fails here until it is one or the other, as `icons.test.ts`
 * holds icons. Needs no stack: it reads the files.
 */
const here = dirname(fileURLToPath(import.meta.url));
const renderer = join(here, '../../../apps/web/src');

/** The dialogs the walk cannot open, each with its reason. Kept few: walk what can be made. */
const EXEMPT: Readonly<Record<string, string>> = {};

/** Every renderer source file, `/`-separated from `apps/web/src`, tests and stories aside. */
function sources(directory = renderer): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [relative(renderer, path).split(/[\\/]/).join('/')];
  });
}

const text = new Map(sources().map((file) => [file, readFileSync(join(renderer, file), 'utf8')]));

/** Draws `role="dialog"` itself. */
const drawsOne = (source: string) => /role="dialog"/.test(source);

/**
 * A wrapper is a shared part (`layouts/`, `parts/`) that draws a dialog for its callers, `Modal` and
 * `ConfirmDialog` among them: it is counted at each caller, never at itself, and a caller of a wrapper
 * that is itself a wrapper is followed on.
 */
function census(): string[] {
  const shared = (file: string) => /^(layouts|parts)\//.test(file);
  const wrappers = new Set<string>();
  const dialogs = new Set<string>();
  const callers = (file: string) => {
    const names = [...text.get(file)!.matchAll(/export function (\w+)/g)].map((match) => match[1]);
    return [...text].filter(([, source]) =>
      names.some((name) => new RegExp(`<${name}[\\s>]`).test(source)),
    );
  };
  const pending = [...text].filter(([file, source]) => shared(file) && drawsOne(source));
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const [file] = next;
    if (wrappers.has(file)) continue;
    wrappers.add(file);
    for (const caller of callers(file)) {
      if (shared(caller[0])) pending.push(caller);
      else dialogs.add(caller[0]);
    }
  }
  for (const [file, source] of text) if (!shared(file) && drawsOne(source)) dialogs.add(file);
  return [...dialogs].sort();
}

/** The dialogs `pseudo.test.ts` walks: each surface's `dialog`. */
const walked = [
  ...readFileSync(join(here, 'pseudo.test.ts'), 'utf8').matchAll(/dialog: '([^']+)'/g),
].map((match) => match[1]!);

describe('every dialog in the pseudo walk (the TE plan, TE-G)', () => {
  const dialogs = census();

  it('finds the dialogs, a wrapper counted at its callers', () => {
    expect(dialogs).toContain('editor/IndexEntryDialog.tsx');
    expect(dialogs).toContain('admin/Extensions.tsx');
    expect(dialogs).not.toContain('layouts/Modal.tsx');
    expect(dialogs).not.toContain('parts/ConfirmDialog.tsx');
  });

  it('walks every dialog, or names why it cannot', () => {
    expect(dialogs.filter((file) => !walked.includes(file) && !(file in EXEMPT))).toEqual([]);
  });

  it('names only dialogs there are, none both walked and exempt', () => {
    expect([...walked, ...Object.keys(EXEMPT)].filter((file) => !dialogs.includes(file))).toEqual(
      [],
    );
    expect(walked.filter((file) => file in EXEMPT)).toEqual([]);
  });
});
