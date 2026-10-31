import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { notesFor } from './release-notes.js';

/**
 * The desktop release (the DR plan, DR-F, DR-G): the workflow that publishes an installer on a close,
 * and the packaging it publishes. Read as text, as `dockerfile.test.ts` reads the image's build.
 */
const root = join(process.cwd(), '..', '..');
const workflow = readFileSync(join(root, '.github', 'workflows', 'release.yml'), 'utf8');
const builder = readFileSync(join(process.cwd(), 'electron-builder.yml'), 'utf8');

describe('the release workflow (the DR plan, DR-F)', () => {
  it('ADM-052 releases after CI passes on a push to main, from the commit CI passed, and on request only builds', () => {
    expect(workflow).toMatch(
      /workflow_run:\s+workflows: \[CI\]\s+types: \[completed\]\s+branches: \[main\]/,
    );
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflow).toContain("github.event.workflow_run.event == 'push'");
    expect(workflow).toContain(
      'ref: ${{ github.event.workflow_run.head_sha || github.event.pull_request.head.sha || github.sha }}',
    );
    expect(workflow).toContain('--target "$SHA"');
    // By hand, or on a pull request changing the release, it uploads what it built and publishes nothing.
    expect(workflow).toMatch(
      /if: github\.event_name != 'workflow_run'\s+uses: actions\/upload-artifact@v\d/,
    );
    expect(workflow).toMatch(
      /if: github\.event_name == 'workflow_run' && steps\.version\.outputs\.go == 'true'\s+env:/,
    );
  });

  it('ADM-052 builds on Windows, releases a version once, and never cancels a release under way', () => {
    expect(workflow).toContain('runs-on: windows-latest');
    expect(workflow).toContain('git ls-remote --exit-code --tags origin "refs/tags/v$VERSION"');
    expect(workflow).toMatch(/concurrency:\s+group: release\s+cancel-in-progress: false/);
    expect(workflow).toContain('pnpm install --frozen-lockfile');
    expect(workflow).toContain('pnpm exec turbo run build --filter=@alloy-works/desktop...');
    expect(workflow).toContain('--publish never');
  });

  it('writes releases and nothing else, and never hides a failure', () => {
    expect(workflow).toMatch(/permissions:\s+contents: write\s+packages: read\n/);
    expect(workflow).not.toContain('continue-on-error');
    // An action from outside GitHub runs pinned by commit, as a tag can be moved under it.
    const actions = [...workflow.matchAll(/uses: ([^@\s]+)@(\S+)/g)];
    expect(actions.length).toBeGreaterThan(0);
    for (const [, action, ref] of actions) {
      if (!action!.startsWith('actions/')) expect(ref).toMatch(/^[0-9a-f]{40}$/);
    }
    expect(workflow).not.toMatch(/secrets\.(?!GITHUB_TOKEN)/);
  });

  it('ADM-052 attaches the installer, its blockmap and the update metadata, named by the version', () => {
    for (const file of [
      'release/AlloyWorks-Setup-$VERSION.exe',
      'release/AlloyWorks-Setup-$VERSION.exe.blockmap',
      'release/latest.yml',
    ]) {
      expect(workflow).toContain(file);
    }
  });
});

describe('the packaging a release publishes (the DR plan, DR-G)', () => {
  it('ADM-052 names the installer without spaces, which GitHub would turn to dots and latest.yml would miss', () => {
    expect(builder).toContain('artifactName: AlloyWorks-Setup-${version}.${ext}');
    const named = builder
      .split(String.fromCharCode(10))
      .filter((line) => line.startsWith('artifactName:'))
      .map((line) => line.slice('artifactName:'.length).trim());
    expect(named).toEqual(['AlloyWorks-Setup-${version}.${ext}']);
  });

  it('says where the updater looks, and installs for the person alone, so an update asks for no administrator', () => {
    expect(builder).toMatch(/publish:\s+provider: github\s+owner: kenhayward\s+repo: alloy-works/);
    expect(builder).toMatch(/nsis:[\s\S]*perMachine: false/);
  });
});

describe('notesFor (the DR plan, DR-F)', () => {
  const changelog = [
    '# Changelog',
    '',
    'Intro.',
    '',
    '## 0.220.0 - 2026-11-02 (PR #832)',
    '',
    'Desktop releases.',
    '',
    '### Added',
    '',
    '- **Updates.** Offered.',
    '',
    '## 0.219.0 - 2026-10-30 (PR #826)',
    '',
    '### Added',
    '',
    '- **Forms.** Words.',
    '',
  ].join('\r\n');

  it("ADM-052 gives a release its version's own changelog entry", () => {
    expect(notesFor(changelog, '0.220.0')).toBe(
      'Desktop releases.\n\n### Added\n\n- **Updates.** Offered.',
    );
    expect(notesFor(changelog, '0.219.0')).toBe('### Added\n\n- **Forms.** Words.');
  });

  it('refuses a version the changelog has no entry for, rather than publishing empty notes', () => {
    expect(() => notesFor(changelog, '0.221.0')).toThrow('CHANGELOG.md has no entry for 0.221.0');
    expect(() => notesFor(changelog, '0.22')).toThrow();
  });
});
