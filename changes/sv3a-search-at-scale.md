### Fixed

- **Search is fast on a large tenant.** Words are found through their index, and the definitions a search reads through theirs, so a search no longer reads everything its reader may see (#602).

### Changed

- **Past 1,000 matches, search shows the best of the 1,000 changed most recently**, and says so. Its facets then count those 1,000, each shown as at least its count.
- **A term under three characters is looked for as a whole word**, never as part of one.
