# Gaps: 0.13.0

Baseline `0.13.0`, declared 2026-09-13. What this evidence pack does not claim, so that an absence here reads as declared rather than as forgotten.

## Corpus problems

Every defect `pnpm trace check` finds in the corpus, whether or not it touches this baseline - `pnpm trace gate` only fails on the ones that do.

| Kind | ID | Detail |
| --- | --- | --- |
| claims-superseded | REL-002 | is claimed by relationships.md but its status is "Superseded by REL-047", and REL-047, which is in force, is claimed by no design |
| claims-superseded | REL-009 | is claimed by relationships.md but its status is "Superseded by REL-052", and REL-052, which is in force, is claimed by no design |
| claims-superseded | SCH-027 | is claimed by search.md but its status is "Superseded by SCH-050", and SCH-050, which is in force, is claimed by no design |
| claims-superseded | VER-034 | is claimed by storage-and-versioning.md but its status is "Superseded by VER-044", and VER-044, which is in force, is claimed by no design |
| claims-superseded | STY-007 | is claimed by themes.md but its status is "Superseded by STY-056", and STY-056, which is in force, is claimed by no design |
| claims-superseded | STY-036 | is claimed by themes.md but its status is "Superseded by STY-058", and STY-058, which is in force, is claimed by no design |
| cited-undesigned | IAM-018 | is named by apps/service/src/http.test.ts:79 and claimed by no design |

## Excluded

Requirements somebody would reasonably expect to find in this baseline, and why this release does not claim them. See `docs/specification/baselines/README.md` for how this differs from simply being out of baseline.

| ID | Reason |
| --- | --- |
| **IAM-018** | Named only by a `rule:` field, which establishes `Covered` but never `Verified`, and claimed by no design. It cannot be traced end to end, so this release does not claim it. |
| **STY-009** | The theme's character catalogue (`packages/domain/src/theme/schema.ts`, `markNames`) renders only two of the eight marks CNT-031 requires - `strong` and `emphasis`. Underline, subscript, superscript, inline code, defined term and quoted phrase have no character style yet, so "each mark" is not met. |
| **STY-037** | The CSS projection omitting pagination-dependent properties (`css.test.ts`) is a prerequisite, not the requirement: the requirement is that the editor's preview shows the effect it cannot reproduce, and this repository has no editor or preview (`CLAUDE.md`: no authoring UI, no publishing). |
| **STY-052** | The typeface schema (`packages/domain/src/theme/schema.ts`) has an optional `wordFamily` but records no licence or embedding permission at all, for PDF or Word, and no publish report exists anywhere in the repository. The cited test proves only that a declared `wordFamily` is used, not the licence gate or the report the requirement also demands. |

## Everything else out of baseline

1257 in-force requirement(s) this release does not claim at all, named nowhere in this pack because a baseline for an early release does not need one row per requirement it has not reached yet. Counted by tranche, not by identifier:

| Tranche | In force, out of baseline |
| --- | --- |
| T1 | 307 |
| T2 | 175 |
| T3 | 196 |
| T4 | 88 |
| T5 | 58 |
| T6 | 83 |
| Constraint | 350 |
