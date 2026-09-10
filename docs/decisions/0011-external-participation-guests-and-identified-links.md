# 0011 - External participation: guest principals and identified links

- **Status:** Accepted
- **Date:** 2026-09-10

## Context

[IAM-Q03 and IAM-Q04](../specification/requirements/IAM-identity-tenancy-and-access-control.md)
were the two open questions the requirements themselves flagged as most likely to force a change,
and both come from the same place: in this market a document is written by one organisation for
another. A model in which everybody who touches a document works for the tenant that owns it is a
clean model, and it is not the one a consultancy needs.

Three constraints already in force shape the answer.
[IAM-001](../specification/requirements/IAM-identity-tenancy-and-access-control.md) says an artifact
belongs to exactly one tenant and may not be shared between them, and
[ADR-0008](0008-schema-per-tenant-isolation.md) turned that from a rule into a schema boundary
enforced by the database's own roles - cross-tenant reads are not a feature to be written, they are a
thing the connection cannot do. [ADR-0009](0009-federation-and-google-accounts-no-local-passwords.md)
means the product cannot issue an outsider a credential, because it issues nobody a credential.
[COL-N04](../specification/requirements/COL-collaboration-and-review.md) says no anonymous review,
because an audited document cannot contain unattributed changes.

**The question as posed bundles three populations, and conflating them is how this is usually got
wrong.** A client reviewer participates while the document is still moving, is known individually,
and lasts an engagement. A recipient of the finished report reads after publication, may be dozens
of people, and will forward it. The public is unbounded and unknown. Built as one mechanism, these
collapse to the weakest thing that satisfies all three, which is an anonymous link - and an
anonymous link cannot answer _who has seen the version that contained the error we are now
correcting_, which is the question a recall or an erratum turns on, and close to the question this
market is buying.

## Decision

**External people participate as guest principals inside the host tenant, and finished documents
reach outsiders by links that identify their recipient. Nothing is anonymous, and nothing is shared
between tenants.**

**Reviewers become guest principals.** An external person is a principal in the host tenant, marked
external, authenticating by the routes ADR-0009 already allows - a Google account, or the host
tenant's federated provider. IAM-001 is untouched: the artifact still belongs to exactly one tenant,
and somebody from outside is a principal in it rather than a bridge between two.

- **The capability ceiling is read, comment and suggest.** Never edit, never approve a lifecycle
  gate, never publish. A suggestion is inert until an internal author accepts it, which is precisely
  what makes it safe to hand out; approval is not, because LIF's signing acts require a signer whom
  the asserting organisation has identity-proofed, and a guest is not.
- **Expiry is mandatory, not a setting somebody may leave empty.** Every product that offers guest
  access leaks through guests who left the client firm and were never removed. Access carries an
  expiry, defaulted and capped by tenant policy, and extending it is a positive act.
- **The administrator gets the inverse view.** IAM-029 answers "what may this person do"; external
  access needs "who from outside can reach what", because that is the report somebody actually has
  to run.

**Recipients get per-recipient identified links.** A publication is shared to a named recipient who
proves who they are once. The link is revocable with immediate effect, expires, records every access,
and tells a reader holding a superseded publication that a newer one exists.

The reason this is worth building is not convenience, and it is the opposite of how it first looks.
A link appears weaker than an account - but the thing it replaces is not an account, it is **emailing
a PDF**, which is what happens today and which has no reader identity, no revocation and no way to
tell somebody the version in their hand has been superseded. Against the realistic alternative rather
than the ideal one, an identified link is a large improvement to the trail.

**Anonymous and public distribution are ruled out.** PUB-N02 already says the output is documents
rather than a site. A customer who wants a report on a public website puts the file on a web server,
and the product's involvement ends at the file.

**Cross-tenant sharing is deferred, not refused.** Guests serve the case today at a fraction of the
cost. The mechanism IAM-Q04 imagined - a trust handshake, permission evaluation across two role
systems, audit in two places - is expensive, cuts directly across ADR-0008, and only helps when the
client also has a tenant, which for a consultancy's client is usually false.

## What would change the answer

- **A network forming inside the customer base**, where customers' clients become customers in their
  own right. That is what reopens IAM-Q04, and it is a good problem rather than a surprise.
- **Guest administration landing somewhere it is refused.** A host tenant is now administering people
  it does not employ, and offboarding depends on the host noticing rather than on the client's
  directory. Expiry is the mitigation; if it proves insufficient in practice, the alternative is
  cross-tenant sharing, which is the deferred option above.
- **A regime that admits an external attestation.** Guests do not sign because identity proofing sits
  with the organisation asserting the signature. A customer with a workflow where a client's sign-off
  carries real weight would need that examined rather than assumed.
- **A client population that will not sign in at all.** The answer would still not be anonymous
  links; it would be that those recipients get the file, and the product stops claiming a trail it
  does not have.

## Consequences

- **COL-Q03 is settled by this rather than separately.** Internal-only threads stop being optional
  the moment clients are in the document: nobody reviews in front of their client without somewhere
  to talk first. A thread must be markable internal, and the marking must be evident to the people
  who can see it, so that an internal thread is never mistaken for one the client has already read.
- **A guest is scoped, not general.** External access is granted against named documents or spaces
  through the permission model that already exists (IAM-018), not by a status that opens a tenant.
- **Notifications become a leak surface with a wider blast radius.** COL-036 already forbids a
  notification from disclosing content its recipient may not read; with external principals in the
  document, the cost of getting that wrong is a client seeing an internal thread by email.
- **Every publication access becomes an audited event**, which is new: until now the audit trail
  ended at publication (LIF-026), because what happened to the file afterwards was invisible.
- **Two questions are raised and deliberately left open**, as IAM-Q05 and IAM-Q06. What happens to a
  guest's attribution when their access is revoked, given that their comments and accepted
  suggestions are part of the audited record and that an erasure request may point the other way; and
  whether the same person guesting for several tenants is several unrelated principals, which is what
  ADR-0008 implies and what a convenient shared directory would quietly undo.
