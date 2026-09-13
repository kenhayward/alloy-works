import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './compile.js';

/**
 * The issue form's area dropdown is a copy of the corpus's area codes, and a copy drifts. An area
 * added to the corpus and not to the form is an area nobody can file against; one removed from the
 * corpus and left in the form invites a requirement in an area that does not exist.
 */
const form = readFileSync(join(REPO_ROOT, '.github', 'ISSUE_TEMPLATE', 'requirement.yml'), 'utf8');
const index = readFileSync(
  join(REPO_ROOT, 'docs', 'specification', 'requirements', 'README.md'),
  'utf8',
);

/** `| **CNT** | Content and authoring | 7.1 | [file](file) |` in the index. */
const areasInIndex = [...index.matchAll(/^\|\s*\*\*([A-Z]{3})\*\*\s*\|/gm)].map((m) => m[1]!);

/** `      - CNT - Content and authoring` in the dropdown's options. */
const areasInForm = [...form.matchAll(/^\s+- ([A-Z]{3}) - /gm)].map((m) => m[1]!);

describe('the requirement issue form', () => {
  it('offers every area the corpus defines, and no others', () => {
    expect(areasInForm.sort()).toEqual([...areasInIndex].sort());
  });

  it('offers all twenty-one, so neither list is empty by accident', () => {
    expect(areasInForm).toHaveLength(21);
  });

  // This checks the labels a person reads, not the YAML's own keys: a GitHub issue form gives every
  // field an `id:`, so a naive search for "id" would fail on a perfectly correct form.
  it('asks for no identifier, because draft allocates one that is never reused', () => {
    const labels = [...form.matchAll(/^\s+label:\s*(.+)$/gm)].map((m) => m[1]!);

    expect(labels.length).toBeGreaterThan(3);
    expect(labels.filter((label) => /identifier|\bid\b|CNT-\d/i.test(label))).toEqual([]);
  });

  it('keeps the blank issue option, so an observation need not become a requirement', () => {
    const config = readFileSync(join(REPO_ROOT, '.github', 'ISSUE_TEMPLATE', 'config.yml'), 'utf8');

    expect(config).toMatch(/blank_issues_enabled:\s*true/);
  });

  it('tells the person filling it in that a requirement says must or should', () => {
    expect(form).toMatch(/\bmust\b/);
    expect(form).toMatch(/\bshould\b/);
  });

  it('uses no em or en dash, because a tester reads this copy', () => {
    expect(form).not.toMatch(/[–—]/);
  });
});
