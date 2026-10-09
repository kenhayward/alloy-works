import { describe, expect, it } from 'vitest';

import { latestEntry } from './release-notes.js';

const CHANGELOG = `# Changelog

One entry per slice or tranche close.

## 0.147.0 - 2026-10-09 (PR #500)

### Added

- **Administration is a page.** Admin on the rail opens it, with a menu
  grouped by what it holds.
- **Plain http for sources.** An endpoint may start http://.

### Fixed

- **A repeated key is named as one.** A sample says which row repeats it.

## 0.146.0 - 2026-10-08 (PR #483)

### Added

- **Light, Dark and Auto.** Choose the theme.
`;

describe("a version's release notes, from the changelog", () => {
  it('reads the newest entry alone: its version, date, headings and each item, lines joined', () => {
    expect(latestEntry(CHANGELOG)).toEqual({
      version: '0.147.0',
      date: '2026-10-09',
      sections: [
        {
          heading: 'Added',
          items: [
            {
              title: 'Administration is a page.',
              text: 'Admin on the rail opens it, with a menu grouped by what it holds.',
            },
            { title: 'Plain http for sources.', text: 'An endpoint may start http://.' },
          ],
        },
        {
          heading: 'Fixed',
          items: [
            {
              title: 'A repeated key is named as one.',
              text: 'A sample says which row repeats it.',
            },
          ],
        },
      ],
    });
  });

  it('reads nothing from a changelog with no entry', () => {
    expect(latestEntry('# Changelog\n\nNothing yet.\n')).toBeNull();
  });
});
