import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

/** Every source file the package's root entry reaches through relative imports, from `index.ts`. */
function reached(from = join(here, 'index.ts'), seen = new Set<string>()): Set<string> {
  if (seen.has(from)) return seen;
  seen.add(from);
  const source = readFileSync(from, 'utf8');
  for (const match of source.matchAll(/(?:from|import)\s*\(?\s*'(\.{1,2}\/[^']+)\.js'/g)) {
    reached(resolve(dirname(from), `${match[1]}.ts`), seen);
  }
  return seen;
}

describe("the domain's root entry", () => {
  // The renderer imports the root entry, and the browser has no `node:` module: a dev server loads
  // every module it reaches, so one such import blanks the page before anything renders.
  it('reaches no node: module, so the renderer can load it', () => {
    const importing = [...reached()].filter((file) =>
      /from\s+'node:/.test(readFileSync(file, 'utf8')),
    );
    expect(importing.map((file) => file.slice(here.length + 1).replaceAll('\\', '/'))).toEqual([]);
  });
});
