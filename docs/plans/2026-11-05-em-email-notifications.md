# EM: Email

> T7's email slice. **Full tier**: several PRs, migrations, a new contract, a process boundary, tenancy. Ken took the
> recommendations on EM-A to EM-D (2026-11-05). Pre-flight found fifteen defects, answered here. The spike has run.

**Goal:** a person who wants it is told by email that something happened, with a link and nothing of the content; a
tenant chooses how its mail leaves; an invitee and the people of a closing tenant are told too.

**Requirements:** COL-064; COL-060; IMP-045, if channels are all it still lacks; the two new rows from #1001 and #1002.
**Left unclaimed, gaps named:** COL-061 asks for ADM-036's diagnostics, which DG builds, so EM shows a failing channel in
Administration. LIF-072 also asks for events about assets and support access, so EM's audit test cites it only once
they exist. ADM-041's declaration gains one more line to say.

| PR  | Holds                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------- |
| EMa | The plan, `mail.md`, the ADR, the two rows; the channel: table, routes, sealing, audit, export                    |
| EMb | Mailpit; the connector's `/v1/mail`, the worker's loop, the queue, retries; the test send; Administration's Email |
| EMc | A person's choice; notifications and digests by email                                                             |
| EMd | Invitations and closure notices; the walks; the final review; the close                                           |

Each is usable alone: until EMc nothing is sent but a test.

## Ken's answers

| ID   | Question             | Answer                                                                                                   |
| ---- | -------------------- | -------------------------------------------------------------------------------------------------------- |
| EM-A | Which service        | **SMTP**, no vendor API. Mailpit in development.                                                         |
| EM-B | Whose relay          | **The operator's by default, and a tenant's own** (COL-060).                                             |
| EM-C | Beyond notifications | **Invitations and closure notices**, each its own requirement (#1001, #1002).                            |
| EM-D | Who chooses          | **Off for a tenant until an administrator turns it on, then on for each person**, who opts out per kind. |

## Taken by default, for Ken to overrule

- **A tenant's own relay may be on a private address**, past the guard's permanent refusals (loopback, link-local, the
  gateway, the platform). The webhook rule is public-only because the reply is shown; here a code alone is, and a
  regulated tenant's relay is why EM-A chose SMTP.
- **No "this provider vouches for its addresses" setting.** A provider that omits `email_verified` leaves its people
  unmailed; Administration shows how many, and the guide says why (EM-G).

## Decisions

- **EM-E Nothing of the content** (COL-036). Subject and body say what kind of thing happened and link to it: no title,
  text, actor or document name. Digests send counts alone (COL-053). In the person's `interface_language`, else `en-GB`:
  a tenant has no language. The words live in `packages/domain`, with their own check for the pseudo-locales and the
  no-dashes rule. `Auto-Submitted: auto-generated` on every mail.
- **EM-F Queued by trigger**, invoker's rights as `webhook_queue_notification`, after insert on `notification`: all six
  inserts pass through it, and both restores disable user triggers, so an import mails nobody. The trigger tests that
  the channel is on and the recipient no service identity, or every tenant with mail off queues a row per notification.
  `email_delivery` holds **typed foreign keys** with cascade (`notification_id`, `invitation_id`, `principal_id`), and no
  address or text, so erasure and withdrawal drop rows unaided.
- **EM-G Decided again at sending, by purpose.** A notification: one `mayStillBeTold(trx, notification)`, shared with
  `listInbox`, covering disabled, erased, service identity, a thread made internal, spend, a digest's artifacts and
  `readableOf`; `readableOf` alone passes a disabled person (`access-facts.ts:84`). A verified address only, as
  `email_verified` is false after an unverified sign-in. An invitation reads `invitation.email`, unaccepted and
  unexpired: its principal is never verified yet. A closure notice: EM-V. Drops are recorded by reason and counted in
  Administration.
- **EM-H Held 5 minutes, dropped if read by then.** Removing a notification removes its row.
- **EM-I Through the connector** (ADR-0064): `POST /v1/mail`, `CONNECTOR_MAIL_KEY`, a child per send, the guard's pinned
  address, at most 2 mails at once beside webhooks' 4, of 8 children. The password is sealed as `mail-credential`,
  **bound to tenant, host, port and username**, and re-entered on changing any, or an administrator could repoint the
  host at their own server and read it through AUTH. The operator's password is the connector's alone, in
  `takeConnectorConfig`'s delete list; the worker names `platform`. **The operator's from address and each tenant's
  quota are enforced in the connector**, so the mail key cannot send anything through the operator's credential.
- **EM-J TLS.** Ports 465 and 587, TLS required, certificate verified by name, `CONNECTOR_MAIL_PRIVATE` alone (as XR got
  its own) relaxing any of it, with `startWarnings`. CR or LF refused in every value before the library sees it: the
  spike found it rewrites `to` with a line break into another recipient, though it keeps the headers safe.
- **EM-K Who it is from.** On the operator's relay the address is the operator's, with the tenant's name displayed. On
  its own relay the tenant names the address; SPF and DKIM are its relay's, and the guide says so.
- **EM-L At least once, a stable id** (API-045): `email_delivery.id`, a uuid, as `Message-ID` and `X-Alloy-Event-Id`. Not
  the notification's number, which an import renumbers. A send unrecorded sends again with the same id.
- **EM-M Retries.** `skip locked` and a lease recomputed for these times, at most 50 a pass, tenants concurrent, a
  tenant's pass ending at its first relay-level failure, so a black-holed relay stalls only that tenant. From 30 s
  doubling to an hour. **Age is decided at claiming**, from `first_attempt_at`, so a suspension or a quota's wait costs
  no attempt: 24 hours for a notification, 14 days for an invitation and to the end of the grace for a notice. A 5xx
  for one recipient gives up that row; a relay's failure is the channel's. Never disabled by the system.
- **EM-N Failures show in Administration**: state, last attempt, its SMTP code, what waits, what was dropped and why.
  Never the reply's words, which can quote an address. `failing_since` and `told_at` on the channel, reset on success,
  so those holding `configure_services` are told once, in a savepoint, by a new inbox kind that is itself never mailed.
  No bounces.
- **EM-O The channel** is `configure_services` with a session, the password `rotate_secrets` (`identity.md:202`), neither
  given to tokens. Each change audited. Exported without its secret and **arriving off** in both restores, whichever
  relay, so a copied tenant mails nobody (IAM-066). It has an `id` and joins `export-tables.ts:12`'s secret holders.
  Queue and attempts left out. `tenantIsEmpty` counts a configured channel. A singleton in exports, so a part leaves this tenant's alone. Not on an organisation's tenant, whose invitations take the operator's relay regardless (EM-U).
- **EM-P The test send** goes only to the caller's own verified address, and says only the code.
- **EM-Q Links.** Hostnames have no primary, so the first in the order `tenant-database.ts:116` sorts by, read outside
  the tenant transaction, with a worker setting for scheme and port. No hostname drops the row. No token in any mail.
- **EM-R No relay configured.** The connector answers `relay_not_configured`: dropped at once with that reason, an
  operator's log line. `GET /v1/mail-channel` says whether the operator's is offered; `PUT` refuses `platform` when not.
- **EM-S Quotas.** Per tenant per hour on the operator's relay, the operator's setting: beyond it, rows wait. Counted for
  ADM-048. Invitations: 100 a day per tenant, shares among them, and one a day per address, since every repeat of
  `invite` renews.
- **EM-T Tenant states.** The loop walks `liveTenants()`; a second claim walks `closingTenants()` for purpose `closure`
  alone (`sweeps-by-state.test.ts:23` learns `mail.ts`). `states.ts:46` and its checked guide table change: suspended
  keeps what waits until its age; closing sends notices alone.
- **EM-U Invitations** (#1001): a trigger after insert, or update of `expires_at`, on `invitation`, catching
  `invitations.ts`, `grants.ts:561` and `first-administrator.ts`'s raw client. A share's extension does not mail.
  `sign-in-settings.ts:514`'s update must not fire it. Through the operator's relay if the tenant's channel is off.
- **EM-V Closure notices** (#1002): a trigger on `audit_event` kinds `tenant.closing`, `tenant.closure_cancelled`, and the
  7-day notice from `sweepClosures` in its own transaction, unique on (purpose, `grace_ends_at`, principal). To kinds
  `user` and `external` with an issuer, not disabled, not erased, verified; the unverified counted. Through the
  operator's relay always. Never the operator's notice text (TL-B). Not on suspending.
- **EM-W A person's choice** is a table `notification_email_off (principal_id, kind)`, kept in exports, no row meaning on:
  `notification_preference` allows four kinds and a required cadence (`0079:146`). The digest is its own kind for opting
  out, counting only kinds left on. The tenant's own policy (COL-060) is `mail_channel.kinds_off`, the same kinds.

## Not in this slice

One-click unsubscribe: RFC 8058 needs an unauthenticated route with a signed token, a new way in. Each mail links to the
person's settings; a bulk sender's rules may force it, and then it gets its own plan. Inbound mail. HTML mail.

## The spike (done)

`nodemailer` 10.3.1, no dependencies, 2.1 MB, against a local TLS server: an address pinned as `host` with
`tls.servername` sends and verifies by name; implicit TLS works; another name's certificate fails before AUTH;
`requireTLS` with STARTTLS refused fails before AUTH (`ETLS`); a 5xx gives `responseCode`; bare LF and CR are normalised,
dots stuffed; line breaks in subject, name, headers and id reach no new header. A line break in `to` changed the
recipient, hence EM-J. Its errors quote the reply, hence EM-N. Chosen over a hand-written client, which would own
encoding and smuggling. `disableFileAccess`, `disableUrlAccess`, no attachments. It joins the connector's pinned
dependencies (`package.test.ts:54`).

## Interfaces

- **Tenant migration** `0204_mail_channel.sql` (EMa): `mail_channel` (`id`, one row, `enabled`, `relay`, host, port,
  username, `sealed_password` nullable, `from_address`, `from_name`); the audit kind.
- **EMb on:** `email_delivery`, `email_attempt`, the triggers, `failing_since`, `told_at`; EMc `notification_email_off`, `kinds_off`.
- **`packages/db`:** new `mail.ts`: `channelOf`, `setChannel`, `claimEmails`, `recordAttempt`. Both export censuses. Swept
  at 30 days.
- **`packages/domain`:** `EMAIL_HOLD_MINUTES`, ages, the backoff, `MailRequest`, `MailAnswer`, each kind's words.
- **`apps/connector`:** `mail.ts`, a child request, the key differing from every other. Sealing as webhooks' with its
  binding.
- **`apps/service`, contract:** `GET`, `PUT /v1/mail-channel`, `PUT /v1/mail-channel/password`, `POST /v1/mail-channel/test`; documented, in the censuses; openapi regenerated. A relay with no username holds no password.
- **`apps/web`:** Administration's Email; Settings' choice per kind. Seen rendered, walks run.
- **`deploy`:** a pinned Mailpit on `connector-egress` with a CA (`CONNECTOR_CA_FILE`), a second network for its API,
  checked against `connector-isolation.test.ts`; a third network for an outside relay, as `compose.lan.yaml` adds. The
  operator relay's rule: `deny` without `PRIVATE_RANGES`. `ALLOY_SMTP_*` to the connector only.

## Tests (titles; each cites only what it shows)

- `COL-064 tells a person by email of a notification, with its link and none of its content`
- `COL-036 sends no title, text, actor or document name in the subject or body`
- `drops a mail unsent for a disabled person, a thread made internal, spend they may not see, or what they may no longer read`
- `sends nothing to an unverified address, an erased person or a service identity, and counts them`
- `drops a mail for a notification read within the hold`
- `sends the same id when a send is repeated after an unrecorded success`
- `a whole or part restore queues no mail, and a channel of either relay arrives off`
- `COL-060 refuses a change to the channel without configure_services, and exports it without its secret`
- `audits a change to the channel`
- `will not open a password for a host, port or username it was not sealed to`
- `the connector refuses any from address but the operator's on the operator's relay, and past the tenant's quota`
- `refuses a relay without TLS, a certificate for another name, and a line break in any value`
- `sends a test only to the caller's own address`, `keeps no words of an SMTP reply`
- `a black-holed relay delays only its own tenant`
- `a suspended tenant's mail waits without an attempt, and passes its age at claiming`
- `tells those who may configure once that a channel is failing, and never mails that`
- Invitations: `mails on every path that invites or renews but a share's extension`, `one a day to an address`
- Closure: `tells each person on starting to close, once at 7 days, and on cancelling, from every path`
- Hostile, in the connector: a relay resolving to a private address, rebinding between lookup and connect.
- e2e over Mailpit: a mention arrives; a digest arrives; an invitation arrives and its link signs in.

## Docs

`mail.md` (new) with `## Requirements owned`; `system.md`'s mail node and open question; ADR for SMTP through the
connector; `tenant-lifecycle.md`'s table and two deferrals, `states.ts` and its guide table; `collaboration.md`;
`identity.md`'s permission table; a guide to setting up a relay; `deploy/README.md`; `docs/features.md`; README. One
fragment per PR.
