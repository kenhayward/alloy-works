# Connecting CT Studio

How an administrator sets up the receiving side of [the CT Studio sink](ct-studio-sink.md) from the
interface instead of the API: one **Connect CT Studio** flow in Administration that makes the
service identity, grants it a space, issues its token, sets what deliveries become, and ends on a
page that can be pasted into CT Studio. Ken's answers of 2026-10-30 shaped it. The sink itself, its
contract and its delivery store are unchanged except where [Properties](#properties-mapped-ignored-or-unlisted)
says.

## Why

Every deployment so far was set up through four API calls
([the guide](../guides/ct-studio-sink.md), steps 2 to 4), with ids copied between them by hand, and a
CT Studio entry assembled from memory. That is slow and easy to get wrong, and it will be repeated
for every environment and every space that receives deliveries.

## Goals, non-goals, anti-goals

- **Goal:** an administrator who has never read the guide connects a space in one sitting, and leaves
  with everything CT Studio needs in front of them.
- **Goal:** connecting a second space is a shorter pass through the same flow: same identity, same
  token, nothing to change in CT Studio's `.env`.
- **Goal:** the field mapping is decided before anything is delivered, and a property nobody decided
  about is noticed rather than lost.
- **Non-goal:** changing anything in CT Studio. The flow hands over text; the administrator pastes it.
- **Non-goal:** more than one CT Studio per environment. One identity per environment receives every
  delivery to it.
- **Non-goal:** disconnecting a space. Removing its grant (Roles) and turning data off (the space's
  CT Studio section) already do it.
- **Non-goal:** a "test the bridge" button. Only the bridge can sign a `/bridge` call; CT Studio's own
  connection test is where reachability is checked.
- **Anti-goal:** the signing key shown, stored or asked for anywhere in the interface. It is a
  deployment secret (`SECRET_BRIDGE_KEYS`) and stays one.
- **Anti-goal:** the token kept anywhere after the hand-off page closes, as for every other token.

## The flow

**Administration → CT Studio** (`#/admin/ctstudio`, in the `environment` group), for a tenant
administrator. The section opens on a summary of what is connected: the identity, its token's expiry,
and the spaces it can deliver to with each one's settings. **Connect a space** starts the flow.

If the service was started without `SECRET_BRIDGE_KEYS`, the section says so above everything else:
setup still works, but CT Studio is refused until the key is set and the service restarted.

1. **Choose the space.** Any space the administrator administers. One already connected opens its
   settings instead.
2. **CT Studio's identity.**
   - **First time:** the flow makes a service identity named "CT Studio deliveries", grants it the
     Author role at the space, and issues it a token with scopes `create` and `edit`, expiring in
     365 days.
   - **First time, with an identity made by hand** (through the API, as every deployment before
     this flow was): the flow offers the environment's enabled service identities to **adopt** as
     CT Studio's instead of making one. CT Studio keeps the token it holds; the administrator picks
     which of the identity's live tokens that is (by name and expiry, defaulting to the one that
     expires last _(my call)_), so the summary can show its expiry. Adopting issues no token, so the
     hand-off page has no token on it, only the `.env` block if CT Studio needs it and step 4. Its
     existing grants stay; the Author grant at the chosen space is added if missing.
   - **Later spaces:** it reuses that identity and its token and only adds the Author grant at the
     new space.
   - **Token near expiry** (within 30 days) **or expired:** the summary says so and offers **Issue a
     new token**, which issues one and shows a shortened hand-off page (the token and step 3 of the
     instructions). The old token is left to expire, so CT Studio keeps working until it is swapped;
     the page offers to revoke it once the new one is in. The environment records CT Studio's
     current token as well as its identity, so the summary shows that token's expiry and knows which
     one is old. _(My call.)_
   - **Identity disabled:** disabling is one-way and revokes its tokens, so it is never undone or
     worked around silently: someone may have disabled it to cut CT Studio off. The summary says
     deliveries are refused and offers **Replace the identity**, which makes a new one, records it
     as CT Studio's, grants it Author at every connected space and issues its token. CT Studio's
     `.env` is unchanged; only the connection's token is swapped, as for a new token. _(My call.)_
3. **What deliveries become:** the space's settings, the same form as its CT Studio section (below):
   component type, template, field mapping, data tables.
4. **Hand-off page.**
   - **First time:** the token, shown once, with a copy button, as on the API tokens page. Its expiry
     date. Then a block ready to paste into CT Studio's `.env`:

     ```
     BRIDGE_SINKS=[{"id":"<sink id>","url":"<address>/bridge","key":"<the value of SECRET_BRIDGE_KEYS>"}]
     ```

     and short steps:
     1. Put the block in CT Studio's `.env`, replacing the key placeholder with the value of
        `SECRET_BRIDGE_KEYS` from this deployment. If `BRIDGE_SINKS` is already set, add the entry to
        its list instead. Restart CT Studio's bridge.
     2. If this address's certificate is not from a public authority (a LAN or development address),
        make CT Studio's bridge trust it with `NODE_EXTRA_CA_CERTS`.
     3. In CT Studio, make a shared connection for the sink holding the token, and test it: it names
        "CT Studio deliveries" and this tenant.
     4. Make a target on that connection naming the space, by its name and id (both shown).

   - **Later spaces:** no token and no `.env` change: only step 4, for the new space.

   **The address** is chosen on this page from the environment's hostnames, each as `https://<host>`,
   plus the page's own origin, which is the only source of a port (the LAN proxy's `:8443`). The
   default is the page's origin when it is https, else the first hostname. **The sink id** defaults to
   `alloy-<environment>` (the environment's first hostname label, lowercased) and can be edited; both
   are remembered for the next pass.

**A connected space** is one with saved bridge settings. The summary lists every such space; one
whose Author grant for CT Studio's identity has gone is shown as refusing deliveries, with **Grant
again**. Turning data off changes nothing here. _(My call.)_

Leaving the flow before the hand-off page keeps what was made (identity, grant, token, settings), so
the summary shows a connected space; a token made but never seen can only be replaced (step 2's
**Issue a new token**), never shown again.

## The space's CT Studio section

The settings of step 3, also reachable afterwards from the summary for each connected space.

- **Component type** and **template**, picked from the tenant's lists; either may be left at its
  default (the environment's type, a blank document).
- **Field mapping**, a list filled in before anything is delivered. Each row is a CT Studio property
  name, typed, and either a field of the chosen template or **ignore**. With no template, ignore is
  the only choice. The existing refusals (`field_not_in_template` and the rest) show against their
  row.
- **Data tables**, on or off. Turning it on makes the space's connection, as the settings route does
  today, and then tests it, so Describe and Sample work at once.
- **Unlisted properties that have arrived**: each name, when it was first and last delivered and how
  many deliveries carried it, with **Map to a field** (adds a mapping row) and **Ignore**. Saving the
  settings with a name in the mapping removes it from this list.

## Properties: mapped, ignored or unlisted

The mapping today pairs a property with a field, and a property with no pairing is reported
`property_unmapped`. It becomes three cases:

| A delivered property is  | What happens                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| **mapped** to a field    | as today: converted and filled, or reported `property_unconverted`                                                        |
| **ignored**              | nothing: not filled, not reported, not kept with the delivery                                                             |
| **unlisted** (not named) | reported `property_unlisted` in the delivery's record, kept with the delivery as today, and recorded for the space's list |

**Where the flag shows.** The contract's receipt has no place for warnings (its schema is strict and
CT Studio's to change), so CT Studio is not told. The flag is in Alloy Works: the delivery's record
carries `property_unlisted`, and the space's CT Studio section lists the name. Telling CT Studio waits for a contract that carries warnings. _(Found while planning,
2026-10-30.)_

`property_unmapped` stays for a mapped property whose field has gone from the template or is a
`user` field. None of the three refuses a delivery; `metadata_incomplete` still does, for a required
field left empty.

## What the service gains

- **`propertyMap` values** may be `null`, meaning ignore. Settings saved before keep working.
- **A record of unlisted properties per space** (name, first and last delivered, count), read in
  the bridge settings view as `unlisted`. Saving settings drops the names the mapping now covers. It
  is written for a delivery that succeeds and for one refused, `metadata_incomplete` above all, since
  a required field left empty for want of a mapping is when the list is most needed. A refused
  delivery writes nothing else, so this is a write of its own outside the delivery's transaction,
  and it never makes a delivery fail. A delivery that fails on an error records nothing. _(My
  call.)_
- **A connect route** that does steps 1 to 3 server-side in one call: make, adopt or reuse the identity,
  grant Author at the space if not already granted, issue the token the first time, save the
  settings (provisioning data as the settings route does), and answer with the secret once, the
  identity, the space and what was made. One call, so a half-made connection comes from a failure in
  the middle, which leaves what was made before it and is resumable by running the flow again.
- **A status route** for the summary: whether `SECRET_BRIDGE_KEYS` is set (yes or no only), the
  identity and whether it is disabled, its token's expiry, the connected spaces, the environment's
  hostnames, and the remembered address and sink id.
- **A token route** for **Issue a new token**.
- Which identity is CT Studio's is recorded by the environment, not guessed from a name.
- Every write goes through the existing audit kinds (identity, grant, token, bridge settings).

The exact routes, bodies and permission names are the builder's, following the API's conventions;
each lands in the OpenAPI contract and the generated client.

## Requirements owned

| ID          | How it is met                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------ |
| **API-074** | Administration → CT Studio connects a space, first or later, without the API                     |
| **API-075** | The hand-off page gives CT Studio's `.env` entry and steps, with the token shown once and no key |
| **API-076** | A property is mapped, ignored, or unlisted; an unlisted one is reported and listed for the space |

## Left to the builder

The screens' layout and wording within the interface's conventions and catalogue; the route paths
and bodies; the table for unlisted properties and where CT Studio's identity is recorded; how the
flow is split into components; the tests, each starting with its requirement's id.

## As CC built it

Built by [the CC plan](../plans/2026-10-30-cc-connect-ct-studio.md). Where the build settled what this
design left open:

- **Routes.** `GET /v1/ct-studio`, `POST /v1/ct-studio/connections` and `POST /v1/ct-studio/tokens`,
  each administer at the environment with a session. The two that issue a token declare that they
  change access and take no idempotency key, so no remembered answer holds a secret.
- **The record.** A single `ct_studio` row (migration 0174): the identity, the token CT Studio holds
  (null once revoked, as a revoked token's row is gone), the address and the sink id.
- **Unlisted properties.** `bridge_unlisted_property` (0173). Recorded for any refusal after the
  space's settings are read, not only `metadata_incomplete`, in a transaction of its own that never
  fails the refusal.
- **Testing the data connection.** The page calls `POST /v1/connections/{id}/test` once connect has
  answered, rather than the connect route running the test: the test is answered after its own
  commit, through the connector.
- **The field list** on the settings form comes from the template's document-level schemas and their
  entries; the service still refuses a mapping to a field the template does not give, against its row.
- **The address** is chosen from the page's own origin, when https, and `https://` before each of the
  environment's hostnames; it cannot be typed.
