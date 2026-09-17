import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dist = fileURLToPath(new URL('../dist', import.meta.url));

function declarations(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return declarations(path);
    return entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

// A consumer reads dist, not src. A relative import there naming a file the build did not write
// is not an error under skipLibCheck: it quietly becomes `any`, and so does every answer the client
// gives. This package's own typecheck reads src and cannot see it.
describe('the built declarations', () => {
  it('name only files the build wrote', () => {
    const missing = new Set(
      declarations(dist).flatMap((file) =>
        [...readFileSync(file, 'utf8').matchAll(/from '(\.{1,2}\/[^']+)\.js'/g)]
          .map((match) => join(dirname(file), `${match[1]}.d.ts`))
          .filter((target) => !existsSync(target))
          .map((target) => relative(dist, target).replaceAll('\\', '/')),
      ),
    );
    expect(declarations(dist)).not.toHaveLength(0);
    expect([...missing]).toEqual([]);
  });
});
