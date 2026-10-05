# Change fragments

Each PR adds one file here instead of editing `CHANGELOG.md` or `version.json` ([ADR-0037](../docs/decisions/0037-change-fragments-and-versions-at-a-close.md)).

- Name: `<short-slug>.md`, lower-case, hyphens.
- Body: one or more `### Added`, `### Changed` or `### Fixed` headings, each with bullets.
- Write for a user, one or two lines a bullet. Plain hyphens, no em or en dashes.

```markdown
### Added

- **Footnotes in tables.** A table's note can be added from the Table panel.
```

## At a close

When a slice (a plan's work) or a tranche closes, its last build PR also ([ADR-0039](../docs/decisions/0039-ci-at-two-speeds-and-fewer-prs.md)):

1. Bumps `version.json` and its two mirrors: Minor +1 if any fragment has `### Added`, else Build +1.
2. Adds one `CHANGELOG.md` entry, `## X.Y.Z - YYYY-MM-DD (PR #n)`, merging the fragments' headings.
3. Deletes the fragments.
4. Brings `docs/architecture.md` up to date, and drafts the baseline for Ken to declare.

A hotfix that must ship alone is its own close.

`apps/desktop/src/version.test.ts` checks the fragments' shape.
