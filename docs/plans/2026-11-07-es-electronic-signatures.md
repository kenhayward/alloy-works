# ES: Electronic signatures

> T7's regulated sign-off. **Full tier**: several PRs, a migration and a stored shape, auth (re-authentication),
> a new contract. Drafted 2026-11-07 from Ken's direction (#1060). Ken answered ES-A to ES-D and ES-N to ES-P (2026-11-07); the rest
> are taken by default, for Ken to overrule. Pre-flight ran 2026-11-07 and reshaped ES-E to ES-M; ES-Q and ES-R answer ES-N and ES-O.

**Goal:** a document's approval that needs a signature takes one from each role its quorum names, each signer
re-authenticated, holding the role and seeing every part of what they sign, all on one baseline that is the electronic
record; the signatures are shown in the product and in that baseline's published output.

**Requirements:** LIF-080, LIF-081, LIF-083 to LIF-085, LIF-087, LIF-088; LIF-076 (`signature.applied`); LIF-062 for
a signature's offset. **Gaps named, not claimed away:** LIF-034 and LIF-035 are EV's; nothing signs a PDF
cryptographically (LIF-N01); only documents are signed (LIF-087); LIF-Q03 stays open beyond signatures.

**What exists** (the map and pre-flight, 2026-11-07):

- **Gates** (`workflow.md`, WF2): a transition with `gate`, permission `approve`. `decideGate`
  (`workflow-gates.ts`) records a `workflow_approval` per person in the **round** begun by entering the gate's
  from-state, counted for the current version only; `passes` counts people (`count + 1 >= approvals`, :182); any one
  rejection returns to `reject.to`, **skipping** `notAuthor`, `approval.given` and conditions (:129-167). The newest
  definition decides wherever it has the state, so a gate can change mid-round. The body takes `line` and `publish`.
  Refusal codes are dotted (`version.moved`). Only a move sends a stream notice, not an approval that does not pass.
- **What a document version binds**: references are `pinned`, `latest` or `approved` (STR-058); images and bound
  values resolve when read. A **baseline** pins all of it (every reference's version, every image's asset version,
  every binding's dataset version, layout, theme, template), is insert-only with foreign-key pins, carries a digest
  over its pins (VER-043), reads as it was (STR-047) and publishes the same bytes later (PUB-046). A document gate with
  `baseline` takes one on the passing approval, by the approver; one it cannot make refuses the approval
  (`gate_baseline_refused`).
- **Re-authentication** (`identity.md`): `session.authenticated_at`, one column, overwritten by each sign-in or
  re-authentication; `recentSignIn` on a route. The return address is `SIGN_IN_RETURN`, `[a-z0-9-]` segments, 200
  characters. A dirty editor sets `beforeunload`, and the desktop shell has no `will-prevent-unload` handler, so the
  round trip is silently cancelled there.
- **Roles**: created and listed only; exported **by name** (`export-tables.ts:234`). A grant walk counts a role only
  where it holds the permission asked (`decide.ts:207`); `approve` is in `externalCap`, so an outsider never approves.
- **Printed approvals**: the approval page is filled for a gate's approved baseline only, by display name, "never an
  address", since a publication leaves the environment (`publishing.ts:2322`).
- **Erasure** erases every audit label naming the person; its preview states what remains (VER-038).

| PR  | Holds                                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESa | The plan, an ADR; a document gate's `signature`, validated, roles by name; `holdsRole`; `signatureManifest` and the MAC key; `electronic_signature` (0221); Workflows |
| ESb | Signing: the signing attempt, the baseline at the first signature, the quorum by roles, `signature.applied`, reads, stream, export, erasure                           |
| ESc | The signing modal (a clean editor, the provider round trip, the baseline shown, the result said); the Signatures tab, verified; the guide                             |
| ESd | Signatures on the baseline's published PDF, Word and HTML; the close                                                                                                  |

## Ken's answers

| ID   | Question                                 | Answer                                                                                                                                                                                                                               |
| ---- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ES-A | How fresh must the re-authentication be? | **Once per signature, and the re-authentication is the act**: Sign starts a signing attempt holding everything the dialog showed; completing it at the provider applies the signature                                                |
| ES-B | A signer's personal data erased          | **The signature keeps the name and address**, a regulated record kept under a legal obligation; audit labels are erased as now, and the erasure preview counts the signatures kept                                                   |
| ES-C | A layout with no approval page           | **Signatures always print**, on a Signatures page in every format, by name, role, meaning, baseline and time, never an address                                                                                                       |
| ES-D | What is signed                           | **A baseline is the electronic record** (LIF-087), against 21 CFR Part 11: only a baseline pins what a document shows and reproduces it (11.10(b), (c)), and a signature names it (11.70). Documents only                            |
| ES-N | How a signature is bound to its record   | **Cryptographically** (11.70): a signature digest over its manifest and the baseline's digest, and a keyed MAC over it with a tenant key held outside the database, checked wherever it is shown. The provider only proves who signs |
| ES-O | Who the signer is (11.100)               | **The provider's immutable identifiers**, never an address: issuer and `sub`, and the provider's stable key (`oid` for Entra ID, whose `sub` is per app registration), recorded on the signature                                     |
| ES-P | Who takes the password                   | **The provider.** The modal shows the username, fixed; Sign opens the provider's sign-in, forced to ask again. Alloy Works never handles a password, and second factors keep working                                                 |

Ken, 2026-11-07: a 21 CFR Part 11 audit of the platform may follow at v1 feature complete; this slice is sufficient
until then.

## Taken by default, for Ken to overrule

- **The baseline is taken at the round's first signature**, approving or disapproving, by that signer, named for the
  revision the gate would designate ("Revision N", "(2)" on a name taken). Every later signature that round names the
  same baseline; the gate passes on it and takes no second one. A new document version starts the round again on a new
  baseline; the earlier one keeps its lapsed signatures, as a record.
- **What the first signer saw is what is baselined**: the dialog is opened on a resolution digest, and the callback
  refuses `resolution.moved` where the baseline it makes differs. Later signers are shown the baseline, not the live
  document.
- **The person shown** in the product is the display name and sign-in address, as the provider last gave them; in
  print, the name alone. The role is shown by name.
- **The quorum is roles, not a count**: a signed gate passes when every role it names now has an approving signature
  on the round's baseline. `approvals` is set to the roles' count when saved.
- **A signer signs once a round**, approving or disapproving; `notAuthor` applies to both at a signed gate.
- **A disapproval is signed too**: rejecting at a signed gate is a signature with the disapproval meaning and a
  reason; a plain approval or rejection there is refused (`signature.required`).
- **The tab shows** wherever a document has a signature on any baseline, the round's current baseline first.

## Decisions (draft)

- **ES-E The gate declares it** (LIF-080, LIF-081, LIF-084): `gate.signature { meaning { approve, disapprove },
roles: string[] }`, roles **by name** (exported by name, never renamed), each meaning 1 to 500 characters, roles
  distinct, at least one. `workflow.invalid` refuses it on any kind but document, on a gate without `baseline`, a role
  that does not exist, or one that does not hold `approve` and `read` (nobody could hold it). The definition's version
  keeps the meanings verbatim.
- **ES-F Holding** (LIF-083): `holdsRole(facts, role, permission)` in `packages/domain/src/access`, pure: the walk
  over that role's grants alone, **and** `decide(facts, 'approve')`, so a nearer deny, the support grant, the external
  cap and token scopes all apply. An external principal never signs; a token never does.
- **ES-G The record** (LIF-083, LIF-087; 0221): `electronic_signature`, insert-only: document, line, `baseline_id`
  (a foreign key) and the baseline's digest, the document version, the `workflow_approval` it is (unique;
  `decideGate` returns its id), round, definition, transition; the principal and, as signed (ES-O), its issuer,
  `sub`, the provider's stable key where it has one, display name, address, role name, title and baseline name;
  `decision`, the meaning verbatim, the reason; `signed_at`, the signer's offset (LIF-062); the signing attempt
  (unique). A trigger refuses a digest not its baseline's, a baseline not the round's, or an approval another's,
  accepting rows an import restores (`workflow_approval` is renumbered). It joins `EXPORT_TABLES` and
  `PARTIAL_CONTENT`.
- **ES-Q Bound by a MAC** (ES-N; LIF-087): `signatureManifest` in `packages/domain`, the canonical text of every
  part ES-G records as signed (internal ids aside, so an import's renumbering changes nothing) with the baseline's
  digest; `digest` its SHA-256; `mac` an HMAC-SHA-256 over the digest, keyed by a key derived (HKDF, its own label)
  from the tenant's sealing key, added to `packages/sealing` beside `sealSecret`. Checked on every read and print:
  a failing signature is shown **Not verified**, never hidden, and told once to whoever reads Diagnostics. An
  export carries the rows; an import into another environment re-keys nothing, so its signatures read **Not
  verified there** unless the sealing key travels, which the ADR names. The key never leaves the service.
- **ES-H Signing** (LIF-080, LIF-085, LIF-087): `POST /v1/documents/{id}/signatures { transition, version, line?,
decision, role, meaning, baseline?, resolution?, reason?, publish?, offset, to }`, a session only, naming the
  round's baseline once there is one and the resolution digest seen before, starts a `sign_in_attempt` of purpose
  `signing` holding the body, and answers where to send the browser. The callback, accepting the provider's answer as
  a re-authentication's, applies it once in one transaction: the baseline made where it is the first, then
  `decideGate`, refusing by name: `signature.required`, `role.not_held`, `role.signed`, `role.unknown`,
  `meaning.moved` (what was shown is what is recorded), `resolution.moved`, `baseline.moved`, `version.moved`,
  `approval.given`, `approval.author`, `gate_baseline_refused`. The return address names only the page; the outcome
  is read from `GET /v1/signatures/attempts/{id}`. Audited `signature.applied { transition, decision, role,
baseline }` before `approval.given` or `gate.rejected` (LIF-076), with its census row, kind requirements and words.
- **ES-I Reads and notice**: `GET /v1/documents/{id}/signatures`, on `read`, `reads: 'content'`; the view carries
  `signatures: n`, and each gate its signature, the round's baseline, roles signed and those the caller may sign
  under. Every signature sends the document's `workflow` stream event, so co-signers' gates refresh.
- **ES-J The dialog** (LIF-085, ES-P): Approve or the rejection's name at a signed gate opens a **modal**, a signing
  icon top left: the username (the sign-in address, shown and fixed, never typed), the person's name, a role from the
  quorum's unsigned roles the caller holds (the only one preselected), the document's name, the baseline (named and
  opened in its read-only view) or that one will be taken, the meaning to be recorded, a reason for a disapproval. No
  password field: **Sign** opens the provider's sign-in with the username as `login_hint`, forced to ask again
  (`prompt=login`, `max_age=0`). Another account signing in there is refused (`reauthentication.mismatch`, by
  issuer and `sub`, as ID's check). It waits for the editor to flush, or says to finish editing, so no
  `beforeunload` cancels the round trip; back on the page, the outcome is said in the service's words.
- **ES-K The tab** (LIF-088): **Signatures** in the document's panel registry, with a `PanelContext` field and an icon,
  present only while `signatures > 0`: every part ES-G records, time in the reader's zone with the signer's offset,
  **Verified** or **Not verified** (ES-Q), the baseline linking to its view.
- **ES-R The guide**: `docs/guides/people-and-scim.md` tells an Entra ID administrator to set the provider's key claim
  to `oid` whether or not SCIM is used, so a re-registered app keeps its signers (ES-O).
- **ES-L Printed** (LIF-088, ES-C): a baseline's publication carries its signatures in PDF (a new template version,
  PDF/UA-1 table structure), Word and HTML; the page's title from the layout's words, defaulting to "Signatures"; the
  conformance kit checks each.
- **ES-M Workflows**: Administration > Workflows makes a document gate signed: two meanings and the roles, from roles
  that may approve, and turns on its baseline.
