# Mail

How an environment tells a person something by email: that something happened, that they are invited, that their
tenant is closing. Built by [the EM plan](../plans/2026-11-05-em-email-notifications.md), which holds the decisions;
all of it is built: the channel, the way out (the queue, the worker's loop, the connector's send, a
test), notifications, invitations and notices of closing.

## The shape in one paragraph

A tenant has at most one **channel**, off until an administrator turns it on. Its mail leaves by the **operator's relay**,
from the operator's address with the tenant's name, or by **its own**, from an address it names. Either way it speaks SMTP
through the **connector** ([ADR-0092](../decisions/0092-mail-leaves-by-smtp-through-the-connector.md)), never the service
or worker, over verified TLS on port 465 or 587.

## The channel

- `GET`, `PUT /v1/mail-channel`, `configure_services` with a session. `PUT /v1/mail-channel/password`, `rotate_secrets`.
- **The password is write-only**, sealed by the connector as `mail-credential` to the tenant, host, port and username.
  Changing any of them drops it and asks again, so an administrator cannot repoint the host at their own server and read
  it through AUTH. A relay with no username holds none.
- **The operator's relay** names no address of the tenant's, so no tenant can send as another's domain. Without an operator's
  relay, it cannot be turned on.
- **Each change is audited**, `mail_channel.changed`, naming no host, address or password.
- **Exported without its password, and arriving off** after a whole restore, so a copied tenant mails nobody. A part leaves
  this tenant's channel alone, as any setting.

## The way out

- **A row a mail**, `email_delivery`: whom it is to and why, never an address or a word, so erasing a person or their
  address leaves nothing to send. Its id is its `Message-ID` and `X-Alloy-Event-Id`, kept across retries (EM-L).
- **The worker claims and sends** every ten seconds, two environments at a time, each's mail one after another, so a
  black-holed relay holds up only its own (EM-M). Each is decided again as it is claimed: a disabled, erased or unverified
  person, or a service identity, is dropped with the reason (EM-G). A suspended environment's mail waits.
- **Through the connector**, `POST /v1/mail` with a key of its own, a child each, two at once. The operator's relay is
  named by the connector, from its own address with the environment's name, within each environment's hour (EM-S); an
  environment's own relay by the password sealed to it. The host is guarded and dialled at the address checked, TLS
  required and verified by name before AUTH, and every value refused a line break before `nodemailer` sees it (EM-J).
- **Retried** from 30 seconds doubling to an hour; a test is given up an hour after its first attempt. A recipient refused
  for good gives up that mail alone; any other failure marks the channel failing until a send clears it (EM-N). Each
  attempt keeps its code and the relay's SMTP code, never its words. Kept 30 days.
- **A test** goes to the caller's own verified address alone, by the relay saved, whether or not mail is on (EM-P).
- **Administration's Email** sets the channel and its password, sends the test, and lists the mail of 30 days by code.
- **Mailpit** is development's operator's relay, over STARTTLS with the development mail CA's certificate.

## Notifications

- **Queued by a trigger** on `notification`, so every path that tells passes through it, and a restore, which disables
  user triggers, mails nobody (EM-F). Only while the channel is on, of the five kinds mailed (a mention, a reply, a
  resolution, being named a reviewer, the daily digest), and never to a service identity. Its row names the notification,
  which cascades: a notification deleted or swept takes its mail with it.
- **Held five minutes**: one read by then is dropped `read` (EM-H). Given up 24 hours after its first attempt.
- **Decided again at sending** (EM-G, EM-W): the channel still on, the kind not in the environment's `kinds_off` nor the
  person's `notification_email_off`, and `mayStillBeTold` (shared reasoning with the inbox: a thread made internal, spend,
  what they may read now). A digest counts the kinds left on alone, and is dropped where that is none.
- **Its words** live in `packages/domain` (`mailWords`): the kind, a link to the inbox and why it came, never a title,
  text, actor or document name (EM-E). In the person's interface language, a pseudo-locale made over as the interface's is.
- **Its link** is `#/inbox` at the environment's first hostname in order, at `MAIL_LINK_SCHEME` and `MAIL_LINK_PORT`;
  an environment with none drops it `no_hostname` (EM-Q). No token is in any mail. `#/inbox` opens the inbox, where each
  person chooses, beside how often each kind is told, whether it is mailed.
- **A failing channel is told** once to those who may configure services, by an inbox kind, `mail`, which is never
  mailed, in a savepoint; a send clears it, and the next failure tells again (EM-N).

## Invitations

- **Queued from the audit log** (EM-U), by a trigger on `audit_event`: `invitation.sent`, which `invite` records on
  inviting and on renewing, and `tenant.administrator_named`, the vendor's naming of a first administrator. A share's
  extension and a narrowing of how one may be claimed record neither, so mail nothing. This is the plan's "a trigger on
  `invitation`" moved to where the inviting paths already agree; both restores disable it.
- **To the invited address**, never verified until claimed, so read from `invitation.email` at sending; dropped
  `accepted` or `expired` where it is no longer open, and gone with the invitation where it is withdrawn.
- **One a day to an address and 100 a day a tenant** (EM-S): beyond either, queued already dropped,
  `invitation_repeated` or `invitation_quota`, so Administration counts it.
- **By the operator's relay where the environment's mail is off**, by its own where it is on. Its link is the
  environment's sign-in, at its first hostname, with no token: claiming is by signing in with the address.

## Notices of closing

- **Queued from the audit log** (EM-V) on `tenant.closing` and `tenant.closure_cancelled`, from every path that records
  them, and 7 days before the grace ends by the closure sweep, once a person (a unique index on the notice, the grace's end
  and the person).
- **To everybody who signs in in the ordinary way**: people and those from outside with an issuer, not disabled or erased.
  Whom it may reach is decided again at sending, so an unverified address is counted among what was dropped.
- **By the operator's relay always**, whatever the channel says, and in a closing environment's own pass, which claims
  nothing else (EM-T). Tried to the end of the grace, or a week for a cancelling's.
- **What is happening and by when**: the day the grace ends, and no link, since a person may no longer be let in.

## Not yet built

One-click unsubscribe (the plan's Not in this slice).

## Requirements owned

| ID          | How it is met                                                                                                                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **COL-060** | The channel is the tenant's: on or off, whose relay, the address its own relay sends from, and which kinds it mails (EM-W), permissioned, audited and in the export                                                                     |
| **COL-064** | A notification is queued by trigger, held five minutes, decided again and sent by the worker through the connector with a link and none of its content, where neither the person nor the environment has turned its kind off            |
| **IAM-089** | A trigger on the audit log queues a mail on inviting and renewing, the first administrator among them, to the invited address with a link to sign-in and no token, limited per tenant and per address, none once withdrawn (EM-S, EM-U) |
| **ADM-055** | A trigger on the audit log and the closure sweep queue a notice to each person, by the operator's relay, whatever the channel says (EM-V)                                                                                               |

Built. **IMP-045** waits for the rest of what it lists. **COL-061** asks for ADM-036's
diagnostics, which DG builds, and **LIF-072** for events that do not exist yet, so this slice claims neither: a failing channel
shows in Administration, and a change to it is audited.
