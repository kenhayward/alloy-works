# XR: Reference sources

> T6's second slice ([reference-sources.md](../design/reference-sources.md), ADR-0068). **Full
> tier**: a new outbound call through the connector, an extension kind, a worker sweep, a status table,
> a workflow condition, assistant tools. Ken's answers of 2026-10-22 are marked **(Ken)**; the rest
> **(default)**. The pre-flight review's findings are folded in.

**Goal:** an author searches Crossref or PubMed from the Cite dialog and cites a result; a cited
source later retracted or corrected is flagged wherever it is cited, its document's owner told, and a
gate can refuse to move a document citing a retracted one.

| PR  | Holds                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| XRa | This plan, the design and ADR-0068; the sources list; the connector's `/v1/reference`; the tenant's switch (0149); search and cite in the dialog |
| XRb | Re-checks: 0150 (the citation index, the status, the notification kind); Check now; the nightly sweep; the flags; the owner told; the gate       |
| XRc | The assistant's tools                                                                                                                            |
| XRd | Extensions of kind `reference`; the walks; the final review; the close (0.207.0)                                                                 |

## Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| XR-A | **Crossref and PubMed built in** (Ken; ADR-0068): a versioned list in domain, each source's host fixed there, with its operations and mapping to CSL-JSON. PubMed is read as JSON alone (`esearch`, `esummary` with `retmode=json`, whose publication types carry a retraction), so no XML parser is taken.                                                                                                                                                                                                                 |
| XR-B | **One outbound route** (default): the connector's `/v1/reference { source, op: 'search' \| 'fetch' \| 'check', query or identifier }`, on the manifest route's precedent: GET, `https` only, no redirect, no userinfo, the guard with the private ranges always supplied (never a default), terms as encoded query parameters only, a byte cap per operation (search 512 KiB, fetch and check 128 KiB), a deadline, JSON depth and list length bounded, no credential. The worker reaches it with a key scoped to it alone. |
| XR-C | **A tenant's switch** (Ken): Administration's **Reference sources** turns each source on or off, on by default; off, it is neither searched nor checked. The Search tab says the search is sent to the source; a re-check sends an identifier alone. The outbound inventory (ADM-041) is T7's.                                                                                                                                                                                                                              |
| XR-D | **Cited from a result** (default; LIB-031): the Cite dialog's Search tab; choosing a result admits it as an entry of the space, offering a match first (LIB-044), `obtained` set, then inserts the citation. Making an entry needs the space's write; without it, only matches are offered.                                                                                                                                                                                                                                 |
| XR-E | **Re-checked on demand and nightly** (Ken; LIB-035): Check now on an entry's page; a nightly sweep, across tenants as `foldNotificationDigests` folds, checks entries cited by a component's latest version, found by a **citation index** (entry to component, written with each version as the reference index is). Each source has one deployment-wide budget (Crossref 10 a second, PubMed 3), shared round-robin across tenants, oldest check first. Entries obtained before 0149 are checked on the first night.      |
| XR-F | **The status beside the entry** (default; ADR-0068): `bibliography_entry_status (entry, source, checked_at, outcome, differs, notice, notified)`, insert or update by the system under the tenant's policy, never a version. Outcomes `current`, `changed`, `gone`, `retracted`, `corrected`; "superseded" (LIB-035) where a source reports it, else named as a gap.                                                                                                                                                        |
| XR-G | **Flagged and told** (Ken; LIB-036): retracted and corrected entries are flagged on each citation (the editor's node view, the Cite dialog, the document's Review) and warned of at publish. A reader who cannot read the entry sees the flag alone, never its content. Told: the document's review owner, else its maker, else the space's administrators, skipping anyone erased or disabled; once per entry, outcome and person, `notified` remembering it.                                                              |
| XR-H | **A gate condition, off by default** (Ken): `noRetracted` for documents, against the components the document places at the version moving, counting `retracted` alone (`corrected` warns), read by the system so every actor gets one answer.                                                                                                                                                                                                                                                                               |
| XR-I | **Assistant tools** (Ken; LIB-040): `search_references` (read, its description limiting queries to the person's own terms, never the document's content) and `cite_reference`, a proposal carrying the result's CSL: accepting it matches or makes the entry as the person accepting, who needs the space's write, then inserts the citation (GEN-024).                                                                                                                                                                     |
| XR-J | **Extensions of kind `reference`** (default; LIB-032): a manifest declaring `search` and `fetch` endpoints, held to XR-B's rules, answering CSL-JSON, admitted as an import is.                                                                                                                                                                                                                                                                                                                                             |

## Risks

- **Rate limits and availability** of public APIs: answered `reference_unavailable`, the source's.
- **Mapping quality** varies by record: a result is admitted as an import is, reporting what it could not represent.

## Built

XR in three PRs: XRa #762, XRb #764 and the close #766, which holds XRc and XRd. Departures: a tenant's
switch is one route over every source; a search names its space in its body; CIa's reference index
already held each citation, so no index was added; Crossref's notices are read from the work's
`updated-by` and `relation` and from `works?filter=updates:`, PubMed's from esummary's `references`
and `pubtype`; a publish warning is a request's `warnings`, counts alone; an assistant's citation
carries its record until a person accepts it, when the entry is matched (by source, then DOI or PMID,
never by title alone) or made; a reference extension's secret is the extension's own, sealed to its
endpoint. The final review found no leak of content and no route to a host a request names; it fixed a
reader able to run a check (now an editor's, once a minute), notices to people no longer able to read
the document, a sweep a failing source could starve, a secret still sent once a manifest stopped
asking for one or the endpoint moved, an extension answering for another record, a 404 taken as every
entry gone, an owner told of a flapping outcome nightly (now once in 30 days), a first check and the
sweep both telling, an accepted citation matched by title alone, and an assistant searching without
limit (five a run). `CONNECTOR_REFERENCE_PRIVATE=allow` lets the suites' stand-in extension be reached
on a private network, extensions alone, as webhooks' flag does. Left, named: LIB-035's supersession,
reported by neither built-in source; an injected document steering the assistant's search terms, held
by the tool's description alone; the per-source budget is each worker's; an approved reference gated at
its component's latest version.
