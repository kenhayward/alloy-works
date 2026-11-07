# 0104 - A signature is bound to its baseline by a keyed MAC

- **Status:** Accepted
- **Date:** 2026-11-07

## Context

T7 asks for electronic signatures (LIF-080 to LIF-088) meeting 21 CFR Part 11: a signature names what was signed
(11.70), who signed it (11.100) and is not transferable to another record. The ES plan
([2026-11-07](../plans/2026-11-07-es-electronic-signatures.md)) records Ken's answers ES-D and ES-N to ES-P. A
document version alone does not pin what it shows (a `latest` reference floats); only a baseline does (VER-043).

## Decision

1. **A signature is a document gate's.** `gate.signature` declares two meanings (approve, disapprove) and the roles
   whose quorum passes it, by name. Only a document's gate, and only one taking a baseline, can be signed.
2. **The baseline is the electronic record.** Each signature names one baseline and carries its digest.
3. **Bound by a digest and a keyed MAC.** `signatureManifest` is the canonical text of every part signed (baseline
   digest, signer, role, title, baseline name, decision, meaning verbatim, reason, time and offset), with no
   internal id, so an import's renumbering changes nothing. Its SHA-256 is the signature's `digest`; `mac` is an
   HMAC-SHA-256 over the digest with a key derived by HKDF, under its own label, from the tenant's sealing key. The
   key never leaves the service, and is never stored or logged.
4. **Signers are named by the provider's immutable identifiers**: issuer, `sub`, and the provider's stable key
   where it has one (`oid` for Entra ID), never an address. Name and address are kept as signed, for reading.
5. **The provider takes the password.** Alloy Works asks the provider to sign the person in again and never handles
   a password.
6. **An import elsewhere reads Not verified there.** An export carries the rows; another environment holds another
   sealing key, so its signatures do not verify unless the sealing key travels with the archive. The key is salted
   with the tenant's id, so a signature copied into another tenant never verifies (11.70); a restore into a new
   tenant, even in the same environment, reads Not verified for the same reason.

## What would change the answer

- A requirement for signatures verifiable outside the environment, or a signed PDF (LIF-N01): an asymmetric key per
  tenant, or a signing service, in place of a MAC.
- A requirement to sign a component or a definition on its own: a record other than a baseline.
- The sealing key being rotated: a key version on each signature, and every earlier key kept to verify.

## Consequences

- `electronic_signature` (0221) is insert-only: the service may insert and select, nothing more.
- Rotating the sealing key makes every earlier signature read Not verified until key versions exist.
- Whoever holds the database alone cannot forge a signature, but whoever holds the service's key can.
