# Support access

How a tenant lets somebody from outside it look, at what and until when, and sees it happening (ADM-022 to ADM-026,
ADM-042). Built by [the SA plan](../plans/2026-11-07-sa-support-access-boundary-and-secrets.md), which holds the
decisions. **SAa to SAc are built**: what each route reads, `read_diagnostics`, support granted, decided, held to its
scope and audited at the service, and Administration's Support access with the support person's own view.

## Who support is

**A named person, invited by address** (SA-A), who signs in through the tenant's invitation path (IAM-072). There is
no platform staff identity and no cross-tenant sign-in; the operator stays the steward's CLI and reads no content
(IAM-087). A tenant whose only way in is its own provider needs a guest account there for support. Granting names an
address: somebody from outside who signed in with it, verified, or else the address invited as such, the invitation
lasting as long as the grant. Somebody inside the organisation is refused (`support_member`).

## Decided apart from grants

An outsider's tenant-level allow is refused and ignored (IAM-071), so support cannot be ordinary grants. **A
`support_grant` row** (0218: principal, scope, spaces, purpose, expires, granted by, revoked by) is written once, then
only stamped revoked or used; the runtime role may neither edit nor remove it, and its person cannot be removed
under it, so no grant is ever lost. A person holds at most one active grant.

- **Active** is `supportActive` (`packages/domain/src/access/support.ts`): unrevoked, unexpired, and ending within the
  tenant's cap on outside access (IAM-049). The expiry is required and capped when granted. **A cap lowered past a
  grant's expiry ends it**: 0218's trigger on `access_policy` revokes it, by nobody named (`revoked_reason`
  `cap_lowered`), audited as `support.revoked` with that reason in the lowering's own transaction, so raising the cap
  again revives nothing. "Active" in a listing is that rule, never the row.
- **The decision** (`decide`, SA-D): while active, support decides **everything** the person asks, in place of their
  grants: `read_diagnostics` at the tenant in every scope, `read` in the granted spaces for a metadata or content
  grant, and nothing else. A denial on the way still refuses, and a token still masks. So listings, search and the
  readable set narrow to the granted spaces with no code of their own, and no tenant-wide read is ever given.
- **The facts**: every loader (`loadFacts`, `loadFactsFor`, `loadReadableSet`) reads the grant under the access
  epoch's lock; the row's trigger takes the epoch on a grant and a revocation (IAM-063) and tells the stream.

## Held to its scope

The route hook ([`support.ts`](../../apps/service/src/support.ts)) runs before a support person's route, using each
route's `reads` ([ADR-0102](../decisions/0102-every-route-declares-what-it-reads.md)), and refuses `403 support_scope`:

- **every write** but signing out, their own sessions, revoking their own tokens, presence and their inbox, so no
  token, thread, import or conversation; `/mcp` is refused too;
- **a read their scope does not reach**: _diagnostics_ reaches the six diagnostics reads and `none` routes;
  _metadata_ adds `metadata` routes; _content_ adds `content` routes. The stream and their own inbox are every
  scope's;
- **a content route not decided in a space** (`decidedBySpace`): one decided by ownership (a job's download, a
  conversation, a person's prompts, an import, an assistant run) or at the environment, which could answer what
  quotes a space not granted. Search, changes since, a relationship and a cohort answer through the readable set,
  so stay. `support-routes.test.ts` pins the list refused.

**The people directory** (`GET /v1/people`) lists nobody to a support person, as to a recipient of shares alone.
Themes, licences, vocabularies and other environment definitions read as `metadata` are configuration, not a space's
content, and stay readable to a metadata grant; those read as `content` are refused with the rest above.

**A content read must carry `Support-Read: <purpose>`**, or is refused `403 support_read_required` (SA-F): the
deliberate act at the API. What passes is then decided as any request is, so a space not granted is not found.

**Support is read twice**: when the request is authenticated, for the hook, and in the decision. A grant landing
between the two leaves the decision restricting reads and permission-checked writes, and `createToken` asks again in
its own transaction; another write needing only a session (a thread's reply, a preference) could still land in that
window, which closes at the next request.

**Diagnostics name only the granted spaces**: query usage and its CSV list documents, definitions and connections
there alone, and Diagnostics' connections likewise (connections live in spaces, data.md). The rest of Diagnostics is
counts and codes, tenant-wide.

## Seen while active

`GET /v1/support-access` lists active and ended grants to every administrator (`administer`, ADM-025's "the tenant",
SA-G); granting and revoking take `grant_support`, which is administrative (ADR-0091's grant limits and last-holder
guard apply), a person's act alone (no token holds it), refused to an outsider, and given by 0218 to every role
holding `administer`. Revoking ends the person's open streams, the environment's own included, which ends at any
change to access for a support person and at their grant's expiry.

**Audited** into the tenant's own log: `support.granted` and `support.revoked` (scope, spaces, purpose, expiry, whom
for), `support.used` once a person a UTC day a grant, and once per content read naming the route, the ids its path
names and the `Support-Read` purpose, each recorded only once the request was answered with success; refusals as `access.refused`, reason `support`. The purposes are sentences,
kept in the detail as a suspension's reason is. `explainAccess` names an active grant and gives each permission
reason `support`. ADM-042's "shown in ADM-025" is met by that listing, the lozenge being ADM-025's own. Withdrawing a support person's invitation is refused (`invitation_supported`), since that would remove their
person and its grants; **revoking the support ends the invitation it made**, lapsed and audited as
`invitation.withdrawn`, so its person cannot sign in later holding nothing.

## Shown

- **Administration's Support access** (`apps/web/src/admin/SupportAccess.tsx`) lists every grant, how it stands as a
  `Chip` (an operational status, not a state of content), and how it ended, `cap_lowered` included. To whoever holds
  `grant_support` it offers the form, each scope explained, its end defaulting to the policy's default and refused
  past the cap (the listing answers both), the service's refusals said as sentences; and **Revoke**, which says what
  it ends first.
- **While any grant is active**, `ActiveSupport` names who, what scope, where and until when at the top of every
  section, to every administrator, linking to the section (ADM-025).
- **The support person** reads their grant on `/v1/me` (`support`, spaces by name). The workspace shows it on every
  page; Administration offers them Diagnostics, Usage, Query usage and Model spending alone, as it does anybody who
  reads Diagnostics and administers nothing, and panels joining an `administer` read (the budget, the limits, the
  embedding model) are asked for apart. An opened page (anything but a list, Home or Administration) is **withheld**
  beyond their scope, and under a content grant **asks first**, its purpose shown; once chosen, `sendSupportRead`
  has every client say `Support-Read` for the window, a reload asking again (ADM-026). A header carries ASCII, so
  the purpose is sent plainly spelt. A metadata grant's opened pages are withheld whole, though some would show
  only titles.

## Requirements owned

| ID          | How it is met                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ADM-022** | A diagnostics or metadata grant reads Diagnostics, or metadata in its spaces, and is refused every content route (`support_scope`)               |
| **ADM-023** | Content read only by the tenant's grant: scoped to spaces, ending at a required, capped expiry, revoked at once, each biting at the next request |
| **ADM-024** | `support.granted`, `support.used` and `support.revoked` in the tenant's own log, which its administrators read                                   |
| **ADM-042** | `grant_support` grants and revokes, administrators review; scope, spaces, expiry, purpose and person on each; audited; named by `explainAccess`  |
| **IAM-070** | `grant_support`, the last of its eight acts, granted through a role and explained like the rest                                                  |
| **ADM-025** | `GET /v1/support-access` answers what is active and what it covers at any time, and every administrator sees it at the top of Administration     |
| **ADM-026** | Content is read only with `Support-Read` at the API; the renderer withholds it beyond the scope and asks before any is read, then says why       |
