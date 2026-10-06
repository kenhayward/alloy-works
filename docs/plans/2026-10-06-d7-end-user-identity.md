# D7: End-user identity

> D7 of [data.md](../design/data.md)'s build order, on D1 to D4, D8 and B1 to B4. PostgreSQL and the
> service alone: SQL Server's assertion waits with D5
> ([ADR-0038](../decisions/0038-sql-server-is-deferred-past-the-first-release.md)). **Full tier** (auth
> and tenancy), **one review** in place of the pre-flight and per-task reviews: a final review of
> D7.1 and D7.2 together, at D7.2. Ken may overrule (question 6).

**Goal:** a PostgreSQL connection can declare `asserted` identity. A run, a sample and a describe on
it run as the person acting, by a role the source administrator made for them, so the source's own
grants and row-level security decide the rows (DAT-077). Only builder-generated text runs that way
(DAT-113), the account's own privilege is checked at every run (DAT-112), a stored result that is a
person's own view says so and is accepted only past DAT-091's warning, and signing out or revoking a
token stops a run in flight within a stated bound (IAM-082).

**Not in D7, recommended (question 1):** the delegated token. Its only consumer is an `http`
connection, which D6 builds; D7 would store a provider token nothing reads.

| PR   | Holds                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| D7.0 | This plan, with a change fragment. Its own PR: it needs Ken's answers ([ADR-0039](../decisions/0039-ci-at-two-speeds-and-fewer-prs.md))    |
| D7.1 | The assertion: the domain's arms, the connector's per-run privilege check and `set_config('role')`, the test's new finding, 0053           |
| D7.2 | The acts: identity keys, provenance, check and accept by identity, the SQL refusal, IAM-082's stop; the review                             |
| D7.3 | The screens, the seeded roles and the whole system; D7's close ([ADR-0037](../decisions/0037-change-fragments-and-versions-at-a-close.md)) |

## Decisions

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Beat                                                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D7-A | **The assertion is `select pg_catalog.set_config('role', $1, true)`**, the role name a bound value, first in the connector's read-only transaction, before describe and run; then `select current_user` is the identity as the source saw it (`asSeen`). Equivalent to `SET LOCAL ROLE`, which takes no parameter and would need the name quoted into text                                                                                                                                                                                                                                                                                                                                                                                                                    | `SET LOCAL ROLE` with a quoted identifier: correct, but one more place the name is text                                                                                        |
| D7-B | **The role is the person's declared attribute, verbatim**: `email` (the principal's, verified at sign-in) or `subject` (the principal's subject at its issuer). Absent, or over PostgreSQL's 63 bytes, is refused before anything runs, `identity_unavailable`; a role the source lacks, or the account may not set, is `identity_unmatched` (22023, 42501)                                                                                                                                                                                                                                                                                                                                                                                                                   | A mapping table, principal to role, kept by an administrator: another stored shape to get wrong, and a role name chosen by a person                                            |
| D7-C | **The source administrator provisions the roles** (question 2): one per person, granted to the connection's account `WITH INHERIT FALSE, SET TRUE` (PostgreSQL 16+), or to a `NOINHERIT` account on 14 and 15. The product creates nothing at the source. A guide in `docs/guides/` says how                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | The product creating roles: the account would need `CREATEROLE`, which DAT-112 forbids in spirit                                                                               |
| D7-D | **DAT-112 checked at every asserted run** (question 3), in the transaction, before the assertion: the account is refused, `account_holds_privilege`, if `has_table_privilege` or `has_any_column_privilege` answers `SELECT` on any table, view, materialised view, foreign table or sequence outside `pg_catalog`, `information_schema` and `pg_toast`. That covers superuser, `pg_read_all_data`, ownership, `PUBLIC` grants and an inherited person's role. The test reports the same finding                                                                                                                                                                                                                                                                              | The test's finding alone (data.md today), which a grant after the test defeats; a view or function at the source that resets the role then reads with the account's own rights |
| D7-E | **The assertion is held to the end**: after the rows, `current_user` is read again in the same transaction, and a result read under any other role is refused, `identity_unmatched`, nothing returned. With D7-D, a source view that calls `set_config('role', ...)` can at most fall back to an account that reads nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Trusting that builder text cannot reset the role: it cannot, but a source view can                                                                                             |
| D7-F | **Builder text alone** (DAT-113, DAT-102): the service refuses a SQL fetch on an asserted connection, `sql_not_permitted` (reason `asserted`), when a definition is saved and at every run, by the connection version it runs on; the connector's `runRequestSchema` refuses an asserted run whose fetch is not `builder`. A connection version may change to `asserted` while SQL definitions name it; they then refuse to run, and where-used names them                                                                                                                                                                                                                                                                                                                    | Refusing the connection version while a SQL definition names it, which blocks an administrator on an author's definition                                                       |
| D7-G | **Who runs as themselves**: resolve, check, sample and describe on an asserted connection run as the caller, by session or by personal token (a token acts as its creator); `test` runs as the account, since it checks the account. The run request gains `identity: {kind: 'service'} \| {kind: 'asserted', role}`                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Describe as the account, which under D7-D lists nothing                                                                                                                        |
| D7-H | **A person's own view stays theirs until they share it**: an end-user dataset's identity key is `asserted:<principal>` (0047 admits it); check re-runs only for that principal (DAT-084); its waiting version is offered to, and accepted by, that principal alone, refused `identity_differs` for anybody else; resolve and accept of one's own view need `sharesOwnView: true`, else `acknowledgement_required` (DAT-091, DA-AE)                                                                                                                                                                                                                                                                                                                                            | Letting another editor accept Ada's waiting view, which publishes her rows without her acknowledgement                                                                         |
| D7-I | **IAM-082's bound: two seconds** (question 5) from a sign-out or a token's revocation committing to the connector's child being killed, every connector call of that session or token, asserted or not. The sign-out and revoke routes notify `credential_ended` on the tenant's channel (the stream's listener); an act waiting on the connector also re-reads its credential each second, so a replica that missed the notice still stops. The connector kills a child whose caller closed the request, and the source sees its client gone within 250 ms (`client_connection_check_interval`). The act answers `authority_ended` with `reason: 'signed_out' \| 'token_revoked'`, logged, recording nothing. The event stream of an ended session closes on the same notice | Waiting for the run's own deadline (up to 120 s); D3-H alone, which stops recording but lets the source keep answering                                                         |
| D7-J | **Provenance's identity widens** to `{kind: 'endUser', mechanism: 'asserted', principal, signInRoute: 'organisation' \| 'google' \| 'token', asSeen}`; the provenance panel and the Value dialog say whose view a value is (DAT-022)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Recording the role alone, which a renamed person's next sign-in would leave unexplained                                                                                        |
| D7-K | **If the delegated token stays in D7** (question 1 answered no): the session row gains `provider_token` sealed with the service's key under a new purpose `provider-token`, context the session's id, and `provider_token_expires_at`; written only by the organisation route; no refresh token; deleted with the session; `identity_expired` once past. Never logged: the sign-in path already strips openid-client's error chain                                                                                                                                                                                                                                                                                                                                            | -                                                                                                                                                                              |

## The stored-shape check

- **0053** (tenant, or the next free number): `connection_test_findings` widens to
  `{account_not_read_only, account_holds_privilege}`. Nothing else: `dataset.identity_key` already
  admits `asserted:<uuid>`.
- **Connection content**: `connectorIdentities.postgres` becomes `['asserted']`; `checkConnection`
  refuses `assertion` on PostgreSQL (`identity_not_supported`) and still refuses `delegated`. Existing
  versions are all `service` and unchanged. Write paths: create, each version, retire, reinstate,
  `dev-content.ts`'s seed.
- **Provenance**: the identity arm per D7-J; stored versions are `service` and read unchanged.
  `identityKey` takes both arms. Write paths: `recordDatasetVersion` from resolve, session resolve,
  check and D8's pending finish; a finish re-decides the identity it was asked under.
- **Run request** (not stored): `identity` per D7-G, the role 1 to 63 bytes, no NUL.

## Task 1: The assertion (`packages/domain`, `apps/connector`, `packages/db`) - D7.1

- Domain: `connection.ts` per the check; `protocol.ts` gains the run and describe `identity`, refined
  to a builder fetch where asserted; `failures.ts` gains `account_holds_privilege`; `identity.ts`'s
  `identityKey` both arms; `provenance.ts` the arm.
- Connector: `postgres.ts` `accountHoldsPrivilege(client)` (D7-D), used by `test` and before every
  asserted run and describe; `run.ts` and `describe.ts` assert per D7-A, read `asSeen`, recheck per
  D7-E; 22023 and 42501 at the assertion read as `identity_unmatched`.
- Migration 0053 per the check.
- Tests: **`DAT-078`** PostgreSQL declares `asserted` and refuses `delegated` and `assertion`
  (`connection.test.ts`). **`DAT-113`** an asserted request with a SQL fetch is refused at the door
  (`protocol.test.ts`); the role travels as a bound value, a role named `x'; reset role; --` is one
  role (`run.test.ts`). **`DAT-077`** two roles under row-level security read different rows of one
  table (`run.test.ts`, the test source). **`DAT-112`** an account granted `SELECT` on one table, on
  one column, through `PUBLIC`, through `pg_read_all_data`, or inheriting a person's role is refused
  at the run, and the test reports it (`postgres.test.ts`). **`DAT-114`** unchanged. Hostile: a
  source view calling `set_config('role', <account>, true)` is refused per D7-E; an unknown role and a
  role not granted each `identity_unmatched`, naming neither.

## Task 2: The acts (`apps/service`, `packages/db`, `apps/connector`) - D7.2

- `data/connector.ts`: each call takes an `AbortSignal`; `data/bindings.ts`, `query-definitions.ts`
  and `connections.ts` pass the caller's identity per D7-B and D7-G and an `authority` watcher per
  D7-I; `sql-access.ts` gains reason `asserted` (D7-F); check and accept per D7-H.
- `app.ts`: `signOut` and token revocation notify `credential_ended {session | token}`; `stream.ts`
  ends that session's streams. Connector `server.ts`: a closed request kills its child.
- Contract: `authority_ended`, `identity_differs`, `account_holds_privilege` documented; `sharesOwnView`'s
  description no longer says nothing is fetched so; `openapi.json` and the client regenerated.
- Tests: **`DAT-102`** a SQL definition on an asserted connection refused when saved and when run,
  including one saved before the connection changed (`query-definition-routes.test.ts`).
  **`DAT-084`** Ada's asserted binding is re-run for Ada and never for Grace (`bindings-routes.test.ts`).
  **`DAT-091`** resolve and accept of one's own view refused `acknowledgement_required` without
  `sharesOwnView` (`placing-bindings.test.ts`, `bindings-routes.test.ts`); Grace accepting Ada's
  waiting view refused `identity_differs`. **`DAT-076`** the asserted half only: an act names the
  caller's role; a principal with no email on an `email` connection is `identity_unavailable`.
  **`IAM-082`** a run held at the source is killed within two seconds of sign-out, and of a token's
  revocation, answering `authority_ended` with the reason and recording nothing, on the replica that
  did not take the sign-out too (`session-routes.test.ts`, `token-routes.test.ts`, a held source);
  an ended session's stream closes (`stream.test.ts`). Cross-tenant harness over the changed routes.

## Task 3: The screens and the whole system (`apps/web`, `deploy`, `tests/e2e`) - D7.3

- Connection page: identity `service` or `asserted` by email or subject, the finding shown. Value
  dialog and Data tab: "runs as you", and DAT-091's warning before resolve or Accept of one's own
  view, sending `sharesOwnView`; a binding another person's view holds says whose, with no Check
  (`ValueDialog.test.tsx`, `DataTab.test.tsx`, citing **`DAT-091`** and **`DAT-022`**).
- `deploy/sources/postgres.sql`: an account `asserter`, `NOINHERIT`, holding nothing; roles
  `ada@example.com` and `grace@example.com` (the stand-in's users) granted to it, `sample.reading`
  under a row-level policy by site. `tests/e2e`: Ada and Grace resolve one binding and see their own
  rows; Grace signs out mid-run and it stops.
- Docs: data.md (D7's decisions folded in; DAT-112 and IAM-082 moved to owned; build order),
  service-foundations.md (IAM-082 claimed for the stream and sign-out), a source administrator's guide
  for D7-C, features.md and the README. The close: fragments, version, architecture, baseline.

## Verification

- Each suite alone, then `pnpm test`, `typecheck`, `lint`, `format`; `pnpm trace check` and `pins`
  after `generate`, which runs after prettier.
- `pnpm test:e2e` against the build's own compose project (`-p alloy-d7 --profile sources`), every
  `ALLOY_TEST_*` and `ALLOY_E2E_*` target set. Never Ken's stack.
- **The review** (D7.2, over D7.1 and D7.2): breaks each citation; probes a role name that is SQL, a
  source view that resets the role, a grant made between test and run, Grace reaching Ada's view by
  check, accept or the pending finish, a sign-out on another replica, and a revoked token mid-run.

## Risks

- **A source view runs as its owner** unless `security_invoker`, so a view owned by a privileged role
  shows every asserted person all its rows. The source administrator's; the guide says so, D7-D cannot.
- **D7-D's strict reading refuses an account any `PUBLIC` table grant** in the source's schemas, which
  some sources have. Named in the finding's words.
- **The per-run catalogue scan** costs time on a source with many thousands of relations; measured in
  D7.1 against 10,000 tables, and capped by the run's deadline.
- **Email as a role**: case and length are the provider's; an address over 63 bytes cannot be asserted.

## Questions for Ken

1. Delegated identity (the session holding the provider's token, RFC 8693 exchange, DAT-076's
   delegated half) moves to D6, where `http` gives it a consumer? **Recommended: yes**; D7-K is the
   shape if not. Waiting for D6 to build D7 whole delays asserted identity for nothing.
2. D7-C: the source administrator makes one role per person, named by the declared attribute; the
   product provisions nothing and keeps no mapping? **Recommended: yes.**
3. D7-D: check the account's privilege at every asserted run, strictly (`PUBLIC` grants included), so
   DAT-112 can be claimed? **Recommended: yes.**
4. D7-H: another person's own view is never offered to or accepted by anybody else? **Recommended: yes.**
5. D7-I: IAM-082's bound is two seconds, for every connector call of the ended session or token and
   for the event stream? **Recommended: yes.**
6. One final review at D7.2 instead of a pre-flight and per-task reviews? **Recommended: yes.**
