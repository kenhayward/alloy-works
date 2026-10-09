/** One change, as a changelog bullet writes it: its bold title, then its sentence. */
export interface ReleaseNote {
  readonly title: string;
  readonly text: string;
}

/** A version's release notes: the topmost entry of CHANGELOG.md, read at build time. */
export interface ReleaseNotes {
  readonly version: string;
  readonly date: string;
  readonly sections: readonly {
    readonly heading: string;
    readonly items: readonly ReleaseNote[];
  }[];
}

/**
 * The newest entry of the changelog (changes/README.md's shape): `## X.Y.Z - date (PR #n)`, then
 * `### Added`, `### Changed` or `### Fixed`, each with `- **Title.** Text` bullets whose lines wrap.
 * Only this reaches the renderer, so About carries its own version's notes and not the whole history.
 */
export function latestEntry(changelog: string): ReleaseNotes | null {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => /^## \d/.test(line));
  if (start < 0) return null;
  const head = /^## (\S+) - (\d{4}-\d{2}-\d{2})/.exec(lines[start]!);
  if (!head) return null;
  const sections: { heading: string; items: ReleaseNote[] }[] = [];
  let bullet: string[] | null = null;
  const close = () => {
    if (bullet === null || sections.length === 0) return;
    const joined = bullet.join(' ');
    const titled = /^\*\*(.+?)\*\*\s*(.*)$/.exec(joined);
    sections[sections.length - 1]!.items.push(
      titled ? { title: titled[1]!, text: titled[2]! } : { title: '', text: joined },
    );
    bullet = null;
  };
  for (const line of lines.slice(start + 1)) {
    if (/^## /.test(line)) break;
    const heading = /^### (.+)$/.exec(line);
    if (heading) {
      close();
      sections.push({ heading: heading[1]!.trim(), items: [] });
    } else if (line.startsWith('- ')) {
      close();
      bullet = [line.slice(2).trim()];
    } else if (bullet !== null && line.trim() !== '') {
      bullet.push(line.trim());
    } else {
      close();
    }
  }
  close();
  return { version: head[1]!, date: head[2]!, sections };
}
