# Mail

How an environment tells a person something by email: that something happened, that they are invited, that their
tenant is closing. Built by [the EM plan](../plans/2026-11-05-em-email-notifications.md), which holds the decisions;
what is built so far is the channel, its first PR.

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

## Not yet built

Sending, retries and failures (EMb); a person's choice and notifications by email (EMc); invitations and closure notices
(EMd).

## Requirements owned

| ID          | How it is met                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **COL-060** | The channel is the tenant's: on or off, whose relay, the address its own relay sends from, and which kinds it mails (EM-W), permissioned, audited and in the export |
| **COL-064** | A notification is queued by trigger and sent by the worker through the connector, where the person has not opted out                                                |
| **IAM-089** | A trigger on the invitation queues a mail with a link to sign-in and no token, limited per tenant and per address (EM-S, EM-U)                                      |
| **ADM-055** | A trigger on the audit log and the closure sweep queue a notice to each person, by the operator's relay, whatever the channel says (EM-V)                           |

Designed here; only the channel is built. **IMP-045** waits for the rest of what it lists. **COL-061** asks for ADM-036's
diagnostics, which DG builds, and **LIF-072** for events that do not exist yet, so this slice claims neither: a failing channel
shows in Administration, and a change to it is audited.
