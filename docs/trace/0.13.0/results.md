# Test results: 0.13.0

Baseline `0.13.0`, declared 2026-09-13. One row per piece of evidence behind the matrix: a citation naming a requirement in its test title or a `rule:` field, or the baseline's own declaration for a requirement no test reaches. The verdict is the gate's, computed from whether every test naming that requirement passed - not a per-test status, because a requirement is verified only when all of its evidence is.

| ID | Kind | Evidence | Verdict |
| --- | --- | --- | --- |
| **IAM-004** | title | apps/service/src/cross-tenant.test.ts:59 | Met |
| **IAM-043** | rule | apps/service/src/google-sign-in.test.ts:142 | Met |
| **IAM-043** | title | apps/service/src/google-sign-in.test.ts:139 | Met |
| **IAM-043** | rule | apps/service/src/sign-in.test.ts:153 | Met |
| **IAM-054** | rule | apps/service/src/google-sign-in.test.ts:218 | Met |
| **IAM-054** | title | apps/service/src/google-sign-in.test.ts:214 | Met |
| **IAM-054** | title | apps/service/src/google.test.ts:26 | Met |
| **STY-027** | title | packages/domain/src/theme/resolve.test.ts:72 | Met |
| **STY-038** | title | packages/domain/src/theme/resolve.test.ts:76 | Met |
| **STY-050** | title | packages/domain/src/theme/css.test.ts:19 | Met |
| **STY-051** | title | packages/domain/src/theme/css.test.ts:23 | Met |
