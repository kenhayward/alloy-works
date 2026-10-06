# 0040 - Asserted identity trusts the source's function authors

- **Status:** Accepted
- **Date:** 2026-10-06

## Context

D7 asserts a person's identity at a PostgreSQL source by `set_config('role', <person>, true)`, run
by the connection's account, which holds `SET` on every person's role (the D7 plan, D7-A and D7-C).
PostgreSQL authorises any later `set_config('role', ...)` in that session against the session's
user, the account, not against the role in force.

D7.2's review reproduced two routes. A function owned by the person, in a view the person's builder
query reads, sets another person's role, reads their rows and sets the first back, so the recheck
of `current_user` (D7-E) still passes. The connector now refuses that: a person's role must be
`NOLOGIN`, create nothing and own nothing, and the account own and create nothing
(`identity_role_unsafe`, `account_holds_privilege`). The re-review found the second: the same
function authored by **any other source user who may create objects** - neither the person nor the
account - reached through a view, does the same.

Three answers were weighed:

1. **Refuse a source where a person may `EXECUTE` any function not owned by a superuser.** Strict,
   but it refuses nearly every real source: `PUBLIC` holds `EXECUTE` on new functions by default,
   and extensions install functions owned by ordinary roles.
2. **Trust the source's authors.** The connector enforces what it can see; the administrator is told
   the rest.
3. **Sign in as each person**, so the session's user is the person and no switch is possible. That
   needs a credential per person, which is delegated identity's territory (D6), not asserted.

Ken chose the second on 2026-10-06.

## Decision

**Asserted identity keeps one person's rows from another only where every role that may create
functions, views or policies on the source is trusted by its administrator as much as the
administrator.** Such a role can already decide what any person sees through the policies and views
it writes; a function that switches role is one more way to do so.

The connector enforces what it can at every asserted run and describe: each person's role is
`NOLOGIN`, creates in no schema or database and owns nothing; the account owns no function,
procedure or view, creates in no schema and reads nothing itself (DAT-112). The source
administrator's guide (D7.3) states the rest as a checklist: person roles as above; `CREATE` on
`public` revoked from `PUBLIC` on PostgreSQL 14 and 15; only trusted roles may create functions,
views or policies; views over data people see are `security_invoker`, or owned by the administrator.

## What would change the answer

- **A customer whose source lets untrusted users create objects**, and who wants asserted identity
  on it.
- **A tenant asking for the strict check** of the first answer: it could become a per-connection
  option, refusing a source where a person may execute a function owned by anyone but a superuser.
- **D6's per-person credentials**, which would let a connection sign in as each person instead of
  asserting them.

## Consequences

- data.md's asserted identity rules state the trust, and its DAT-077 claim carries the condition.
- The D7.3 guide must give the administrator's checklist above; a source that does not meet it is
  outside what asserted identity promises, and the connector cannot detect every such source.
- The connector's own checks stay as they are: no `EXECUTE`-ownership refusal.
