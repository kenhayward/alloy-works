# Test results: 0.13.0

Baseline `0.13.0`, declared 2026-09-13. One row per piece of evidence behind the matrix: every test name the JSON report recorded against a requirement, or the baseline's own declaration for a requirement no test reaches - the complete list, unlike matrix.md's Evidence column, which indexes only the deduplicated citations. The verdict is the gate's, computed from whether every test naming that requirement passed - not a per-test status, because a requirement is verified only when all of its evidence is.

| ID | Kind | Evidence | Verdict |
| --- | --- | --- | --- |
| **IAM-004** | test | no environment accepts another environment's session (IAM-004) has authenticated routes to test | Met |
| **IAM-004** | test | no environment accepts another environment's session (IAM-004) knows how to address the other environment for every route with path parameters | Met |
| **IAM-004** | test | no environment accepts another environment's session (IAM-004) openStream refuses a session from another environment | Met |
| **IAM-004** | test | no environment accepts another environment's session (IAM-004) signOut refuses a session from another environment | Met |
| **IAM-004** | test | no environment accepts another environment's session (IAM-004) getMe refuses a session from another environment | Met |
| **IAM-004** | test | no environment accepts another environment's session (IAM-004) requestSample refuses a session from another environment | Met |
| **IAM-004** | test | no environment accepts another environment's session (IAM-004) getSample refuses a session from another environment | Met |
| **IAM-004** | test | no environment accepts another environment's session (IAM-004) getSample will not reach another environment's data through this one's address | Met |
| **IAM-004** | test | no environment accepts another environment's session (IAM-004) leaves the session working where it was issued, whatever was tried elsewhere | Met |
| **IAM-043** | test | signing in with a Google account refuses to start where the environment does not permit Google (IAM-043) | Met |
| **IAM-043** | test | signing in with a Google account ends the sessions Google issued when the environment closes the route (IAM-043) | Met |
| **IAM-054** | test | signing in with a Google account refuses an account nobody invited (IAM-054) | Met |
| **IAM-054** | test | who a Google account may enter as (IAM-054) admits an invited address, whatever its case, and binds the invitation to that account | Met |
| **IAM-054** | test | who a Google account may enter as (IAM-054) finds that account again by issuer and subject, whatever its address becomes | Met |
| **IAM-054** | test | who a Google account may enter as (IAM-054) refuses another account presenting an address already bound | Met |
| **IAM-054** | test | who a Google account may enter as (IAM-054) refuses an invited address the provider has not verified, and leaves the invitation open | Met |
| **IAM-054** | test | who a Google account may enter as (IAM-054) admits any account of a named Workspace domain | Met |
| **IAM-054** | test | who a Google account may enter as (IAM-054) never matches a named domain on a personal account, whatever its address | Met |
| **IAM-054** | test | who a Google account may enter as (IAM-054) refuses an account nobody invited | Met |
| **STY-027** | test | resolveTheme fails on a style the theme does not contain rather than substituting one (STY-027) | Met |
| **STY-038** | test | resolveTheme is a pure function of its input (STY-038) | Met |
| **STY-050** | test | projectCss spaces blocks with padding, which adds, never with collapsing margins (STY-050) | Met |
| **STY-050** | test | projectStylesXml states spacing and line spacing in twentieths of a point, line spacing as a minimum (STY-050, STY-051) | Met |
| **STY-050** | test | projectTypst states every property of a style at its resolved value (STY-050, STY-051) | Met |
| **STY-051** | test | projectCss moves each line's extra space above it, as Word does, by cancelling CSS's split (STY-051) | Met |
| **STY-051** | test | projectStylesXml states spacing and line spacing in twentieths of a point, line spacing as a minimum (STY-050, STY-051) | Met |
| **STY-051** | test | projectTypst states every property of a style at its resolved value (STY-050, STY-051) | Met |
