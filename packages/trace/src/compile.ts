import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TraceModel } from './model.js';
import { parseCitations } from './parse/citations.js';
import { parseDesignDocument } from './parse/design.js';
import { parseAreaDocument } from './parse/requirements.js';

/**
 * `packages/trace/src` is three levels down from the repository root. Derived from this module's
 * own URL rather than `process.cwd()`, so it is correct no matter where the CLI is invoked from -
 * cwd only happens to be right when the caller runs it from the package directory.
 */
export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const AREA_DOCUMENT = /^[A-Z]{3}-.+\.md$/;

const read = (...parts: string[]): string => readFileSync(join(...parts), 'utf8');

/** Sorted so that the committed file is a function of the documents and not of directory order. */
const documentsIn = (directory: string, matches: (name: string) => boolean): string[] =>
  readdirSync(directory).filter(matches).sort();

const TEST_FILE = /\.test\.ts$/;
const SKIP = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.superpowers']);

/**
 * This package's own tests are not scanned. They verify the tool, not the product, so they cite no
 * product requirement - and their fixtures deliberately use identifiers shaped like real ones,
 * including an area the scanner must NOT ignore, because otherwise the scanner's own tests could not
 * check that it finds anything. Scanning them would report those fixtures as citations of
 * requirements that do not exist, which is the one thing the citation check exists to catch.
 */
const SELF = 'packages/trace';

/**
 * Every test file in the workspaces, as repository-relative POSIX paths, sorted - so that the
 * committed model is a function of the files and not of directory order, on any platform.
 */
export function testFilesIn(repoRoot: string): string[] {
  const found: string[] = [];

  const walk = (directory: string, relative: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const nextRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
      const nextAbsolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (nextRelative === SELF) continue;
        walk(nextAbsolute, nextRelative);
      } else if (TEST_FILE.test(entry.name)) found.push(nextRelative);
    }
  };

  for (const root of ['apps', 'packages', 'tests']) {
    const absolute = join(repoRoot, root);
    if (existsSync(absolute)) walk(absolute, root);
  }

  return found.sort();
}

export function compile(repoRoot: string): TraceModel {
  const requirementsDir = join(repoRoot, 'docs', 'specification', 'requirements');
  const designDir = join(repoRoot, 'docs', 'design');

  const areas = documentsIn(requirementsDir, (name) => AREA_DOCUMENT.test(name)).map((name) =>
    parseAreaDocument(name, read(requirementsDir, name)),
  );

  const designs = documentsIn(
    designDir,
    (name) => name.endsWith('.md') && name !== 'README.md',
  ).map((name) => parseDesignDocument(name, read(designDir, name)));

  return {
    requirements: areas.flatMap((area) => area.requirements),
    nonRequirements: areas.flatMap((area) => area.nonRequirements),
    questions: areas.flatMap((area) => area.questions),
    designs,
    citations: testFilesIn(repoRoot).flatMap((file) =>
      parseCitations(file, read(repoRoot, ...file.split('/'))),
    ),
  };
}
