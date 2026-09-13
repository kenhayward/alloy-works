# Traceability matrix: 0.13.0

Baseline `0.13.0`, declared 2026-09-13. One row per requirement this release is answerable for - nothing outside it appears here; see `gaps.md` for what is not claimed.

The Evidence column indexes the citations `pnpm trace check` scans for - one file:line per kind, not every test that names a requirement. `results.md` carries the complete list.

| ID | Statement | Tranche | Design | Evidence | Verdict |
| --- | --- | --- | --- | --- | --- |
| **IAM-004** | Every read and write path must be covered by a test that attempts access from a second tenant and is refused | T1 | service-foundations.md | apps/service/src/cross-tenant.test.ts:59 | Met |
| **IAM-043** | A tenant must declare which authentication routes it permits - its own provider, Google accounts, or both - and must be able to close a route once it no longer needs it | T1 | service-foundations.md | apps/service/src/google-sign-in.test.ts:142; apps/service/src/google-sign-in.test.ts:139; apps/service/src/sign-in.test.ts:153 | Met |
| **IAM-054** | A tenant accepting Google accounts must say who may enter by that route - the addresses it has invited, and any Google Workspace domains it names - because any Google account can authenticate, and authenticating must never be enough to enter | T1 | service-foundations.md | apps/service/src/google-sign-in.test.ts:218; apps/service/src/google-sign-in.test.ts:214; apps/service/src/google.test.ts:26 | Met |
| **STY-027** | Where a document references a style the theme does not contain, publishing must fail with a named error rather than substituting a default | Constraint | themes.md | packages/domain/src/theme/resolve.test.ts:72 | Met |
| **STY-038** | Style resolution must be deterministic: the same content, style and theme version must always produce the same appearance | Constraint | themes.md | packages/domain/src/theme/resolve.test.ts:76 | Met |
| **STY-050** | The vertical space between two blocks must be the first block's space after plus the second block's space before, in every output format - never the larger of the two in one format and their sum in another | Constraint | themes.md | packages/domain/src/theme/css.test.ts:19; packages/domain/src/theme/ooxml.test.ts:40; packages/domain/src/theme/typst.test.ts:14 | Met |
| **STY-051** | Line spacing must be declared as a minimum distance from baseline to baseline, and must mean that distance in every output format rather than a multiple each format interprets differently | Constraint | themes.md | packages/domain/src/theme/css.test.ts:23; packages/domain/src/theme/ooxml.test.ts:40; packages/domain/src/theme/typst.test.ts:14 | Met |
