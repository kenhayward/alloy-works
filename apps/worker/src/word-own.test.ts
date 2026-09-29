import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * **The Word check drives a Word of its own, and never a person's** (the final review of W15.1). Word's
 * COM server hands a new client the Word already running where there is one, and the check hides the
 * Word it drives - so, attached to a person's Word, it hid their windows. `scripts/word-own.ps1` holds
 * the decision, which `word-check.ps1` dot-sources: refuse before asking COM for Word while any Word
 * runs, and after asking, drive only a WINWORD process that was not there before. PowerShell runs it
 * on Windows alone, with no Word needed; the script's own order is read everywhere.
 */
const HELPER = fileURLToPath(new URL('../scripts/word-own.ps1', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/word-check.ps1', import.meta.url));

/** The helper's answer to `call`, a PowerShell expression over its functions, as JSON. */
function ask(call: string): unknown {
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `. '${HELPER}'; ConvertTo-Json -Compress -InputObject (${call})`,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  return JSON.parse(out.trim() === '' ? 'null' : out);
}

describe.runIf(process.platform === 'win32')('which Word the Word check may drive', () => {
  it('refuses while any Word is running, naming its processes, and asks nothing of Word where none is', () => {
    expect(ask('Get-WordRefusal @(4242, 4343)')).toMatch(
      /^Word is already running \(process 4242, 4343\)\. Close it/,
    );
    expect(ask('Get-WordRefusal @()')).toBeNull();
  });

  it('drives only the one WINWORD process that was not there before it asked, and none where COM gave it another', () => {
    expect(ask('Get-OwnWord -Before @() -After @(77)')).toBe(77);
    expect(ask('Get-OwnWord -Before @(12) -After @(12, 77)')).toBe(77);
    expect(ask('Get-OwnWord -Before @(12) -After @(12)')).toBeNull();
    expect(ask('Get-OwnWord -Before @() -After @(77, 78)')).toBeNull();
  });
});

describe("the Word check's script", () => {
  const script = readFileSync(SCRIPT, 'utf8');

  it('refuses a running Word before it asks COM for one, and hides only the Word it started', () => {
    const refused = script.indexOf('Get-WordRefusal');
    const asked = script.indexOf("GetTypeFromProgID('Word.Application')");
    const own = script.indexOf('Get-OwnWord');
    const hidden = script.indexOf('$word.Visible = $false');
    expect(script).toContain(". (Join-Path $PSScriptRoot 'word-own.ps1')");
    expect(script).not.toMatch(/New-Object\s+-ComObject\s+Word\.Application/);
    expect([refused, asked, own, hidden].every((at) => at > 0)).toBe(true);
    expect(refused).toBeLessThan(asked);
    expect(asked).toBeLessThan(own);
    expect(own).toBeLessThan(hidden);
  });
});
