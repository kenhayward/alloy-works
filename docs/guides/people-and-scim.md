# Inviting, disabling and SCIM

> For the administrator of an Alloy Works environment. How people come and go: by hand in Administration,
> or pushed by your identity provider. The design is [identity.md](../design/identity.md).

Inviting and disabling need `administer` at the environment. **Sign-in** needs `configure_services`, its
secrets and the SCIM token `rotate_secrets`, and a sign-in in the last ten minutes, which the page asks for
as it opens.

## Without SCIM: invite and disable

**Invite** in Administration's **People**, naming an address and, if you wish, the ways in that may claim
it. The person is made when they first sign in with that verified address.

**Disable** in the same place. They are signed out and lose their API tokens at once, any stream of theirs
stops within two seconds, and they cannot sign in until enabled. Their name stays on what they wrote. You
are refused where nobody who can sign in could then configure sign-in.

Disabling here does not reach your identity provider. A person disabled or deleted there is signed out
here at their next request once five minutes have passed since their session last asked the provider,
and loses their API tokens, but only where the provider grants offline access: Alloy Works asks for the
`offline_access` scope, and a client that may not have it (in Okta, one without the Refresh Token grant)
leaves such a person signed in here until their session expires or you disable them. A provider that
cannot be reached signs nobody out. SCIM closes the gap at once, and for every provider.

## With SCIM: your provider pushes people

SCIM is per provider, at the subset Entra ID and Okta use (`Users`, `Groups`; no bulk, no sorting).

1. **Choose the claim before people sign in.** The provider's **Claim that links people to SCIM** is the
   ID token claim equal to SCIM's `externalId`: `sub` for Okta, `oid` for Entra ID, whose `sub` differs per
   application. It is kept at each sign-in, so somebody who signed in before SCIM is the same person when
   pushed. Change it after people have signed in and those people may be refused until an operator
   reconciles them: refused, never merged by address.
2. **Turn on SCIM** on the provider's row. Copy the SCIM address and the token, shown once. The token lasts
   a year; **New SCIM token** ends the old one at once.
3. **At the provider**, set the tenant URL and the bearer token, and map `externalId` to the claim above.

From then on:

- **Only those pushed sign in through that provider**, refused otherwise, with one exception so that turning
  SCIM on cannot lock you out: somebody already known who holds `configure_services` at the environment by a direct,
  unexpiring grant.
- **Inactive or deleted** signs them out and ends their tokens at once. Delete keeps the principal, disabled,
  so authorship and the audit still name them. Pushing them again brings them back.
- **Active again** enables only somebody SCIM disabled. Somebody you disabled stays disabled, whatever the
  provider replays.
- **Groups come from SCIM alone.** A SCIM group feeds the provider's group in **Groups** whose value equals its
  `externalId`, else its `displayName`. With none, its members are held, and a group made later takes them.

**Turn off SCIM** ends the token. People pushed stay, and anybody the provider signs in is admitted again.
Closing the provider also ends its token. Every change appears in the audit as `scim.provisioned`, with what
changed but never a value or a token.
