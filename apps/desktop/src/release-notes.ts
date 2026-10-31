/**
 * A release's notes (the DR plan, DR-F): its version's own entry in CHANGELOG.md, below the heading
 * `## X.Y.Z - date (PR #n)` and above the next. Pure, so the workflow's script is tested here.
 */
export function notesFor(changelog: string, version: string): string {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## ${version} - `));
  if (start < 0) throw new Error(`CHANGELOG.md has no entry for ${version}.`);
  const end = lines.findIndex((line, at) => at > start && line.startsWith('## '));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join('\n')
    .trim();
}
