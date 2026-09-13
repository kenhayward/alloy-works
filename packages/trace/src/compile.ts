import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { TraceModel } from './model.js';
import { parseDesignDocument } from './parse/design.js';
import { parseAreaDocument } from './parse/requirements.js';

/** `packages/trace` is two levels down, and every command runs from its own package directory. */
export const REPO_ROOT = join(process.cwd(), '..', '..');

const AREA_DOCUMENT = /^[A-Z]{3}-.+\.md$/;

const read = (...parts: string[]): string => readFileSync(join(...parts), 'utf8');

/** Sorted so that the committed file is a function of the documents and not of directory order. */
const documentsIn = (directory: string, matches: (name: string) => boolean): string[] =>
  readdirSync(directory).filter(matches).sort();

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
  };
}
