import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `AGENTS.md` is `CLAUDE.md` for other agents (Codex): the same process, so it must not drift. They
 * differ only in the heading and the opening sentence naming the agent addressed; everything after is
 * the same, byte for byte, line endings aside.
 */
const repoRoot = join(process.cwd(), '..', '..');
const read = (name: string): string =>
  readFileSync(join(repoRoot, name), 'utf8').replace(/\r\n/g, '\n');

const CLAUDE_OPENING = '# CLAUDE.md\n\nGuidance for Claude Code in this repository.';
const AGENTS_OPENING = '# AGENTS.md\n\nGuidance for Codex in this repository.';

describe('AGENTS.md', () => {
  it('is CLAUDE.md with only its opening addressed to Codex', () => {
    const claude = read('CLAUDE.md');
    expect(claude.startsWith(CLAUDE_OPENING)).toBe(true);
    expect(read('AGENTS.md')).toBe(AGENTS_OPENING + claude.slice(CLAUDE_OPENING.length));
  });
});
