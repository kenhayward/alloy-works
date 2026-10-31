# Reference sources

How an author finds a source outside the product and cites it, and how a cited source that is later
retracted or corrected is noticed: T6's second slice. Ken's answers of 2026-10-22 shaped it,
[ADR-0068](../decisions/0068-reference-sources-are-declared-and-reached-through-the-connector.md)
records it, and [the XR plan](../plans/2026-10-22-xr-reference-sources.md) builds it. It extends
[citations.md](citations.md).

## The shape in one paragraph

A **reference source** is a declared entry in a versioned list: Crossref and PubMed are built in, and
a tenant adds another as an extension of kind `reference`. The service never names a URL: it asks the
connector to `search` or `fetch` a source by its id, and the connector reaches that source's declared
host through its guard, public addresses only. A result becomes a bibliography entry by the same
admission and duplicate search as an import, `obtained { from: <source and identifier>, at }`. An
entry obtained from a source can be **re-checked**: on demand from its page, and nightly for entries
a live document cites. A check records whether the entry still resolves, which held fields now
differ, and any retraction, supersession or correction the source reports, in the entry's **status**
beside it, never a version. A retracted, superseded or corrected entry is flagged on every citation of it, in the editor and
in the document's Review, and the document's owner is told. A workflow transition may require **No
retracted sources cited**. The assistant can search a source and propose a citation as the person
asking.

## Requirements owned

| ID          | How it is met                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LIB-031** | The Cite dialog's **Search** tab queries a configured source and inserts a citation from a result, matched or made as an entry                          |
| **LIB-032** | Sources are a declared, versioned list in domain; a further one is an extension of kind `reference`                                                     |
| **LIB-035** | Check now and the nightly sweep re-check an entry: whether it resolves, which fields differ, and a retraction, supersession or correction; when it ran  |
| **LIB-036** | A retraction or correction is flagged on each citation and its document's owner told; a gate condition can refuse the move                              |
| **LIB-040** | The assistant's `search_references` and `cite_reference` tools, as the calling person; the entry made, and the citation inserted, when a person accepts |

## The sources

| Id         | Host                      | Search                      | Fetch by | Retraction and correction                                     |
| ---------- | ------------------------- | --------------------------- | -------- | ------------------------------------------------------------- |
| `crossref` | `api.crossref.org`        | `works?query=` (20 at most) | DOI      | `update-to` and `relation` notices, Retraction Watch included |
| `pubmed`   | `eutils.ncbi.nlm.nih.gov` | `esearch` then `esummary`   | PMID     | Publication type `Retracted Publication`                      |

Each answer is mapped to CSL-JSON in domain and admitted as an entry is; PubMed is read as JSON alone.
A search sends the author's terms to the source, which the Search tab says, and a tenant may switch a
source off; a re-check sends an identifier alone. A contact address the deployment configures is sent
as both services' polite-use etiquette asks.

## The status

`bibliography_entry_status (entry, source, checked_at, outcome, differs, notice)`: `outcome` one of
`current`, `changed`, `gone`, `retracted`, `superseded`, `corrected` (0175 adds `superseded`); `differs`
the CSL variables whose values the source now holds otherwise; `notice` the retraction, supersession or
correction's identifier and date. A check takes a retraction first, then a supersession, then a
correction. It is the
system's word about an entry, so it is written without a version; the entry's own fields change only
when a person takes a new version.

## Who is told

A document's review owner, else the person who made it, else the space's administrators, skipping
anyone erased or disabled or who may not read the document; once per entry, outcome and person in
thirty days, however often it flaps, in the inbox. A reader who cannot read
an entry sees a citation's flag, never the entry.

## The gate

**No retracted sources cited** counts the retracted entries the components a document places at the
version moving cite, read by the system so every actor gets one answer; a supersession or a correction
warns.

## Built in XRa

- **The list** is `packages/domain/src/library/sources.ts`, with each request's path and the mappings;
  the fixtures beside it are invented, in each source's shape.
- **The connector** answers `/v1/reference` with CSL already mapped, or `reference_unavailable` and a
  reason (`refused`, `timeout`, `too_large`, `status`, `unreadable`, `connector`); a `fetch` or `check`
  the source does not hold answers no result. JSON past 32 deep, or a list past 10,000, is
  `unreadable`. `CONNECTOR_REFERENCE_CONTACT`
  is the contact address. Its suite reaches fake sources by `referenceOrigins`, a supervisor
  parameter production's server never passes.
- **The switch** is `reference_source_policy` (0149), a row only for a source switched; it is set by
  `PUT /v1/reference-sources { source, enabled }`, recorded as `settings.changed`
  `referenceSources.<id>`.
- **A search** names its space in the body (`space:<id>`), read there; each result carries its
  matches, and the answer whether the caller may make an entry.

## Built in XRb

- **The citation index** is the reference index (0102): CIa already writes a row per citation of an
  entry, `to_kind` `bibliographyEntry`, with each component's latest version, so 0150 adds none.
- **Notices.** A Crossref `check` asks the work and `works?filter=updates:{doi}`: each notice whose
  `update-to` names the work, and the work's own `updated-by` and `relation` (`is-retracted-by`,
  `is-corrected-by`); `retraction`, `withdrawal` and `removal` retract, `correction`, `corrigendum`,
  `erratum`, `addendum` and `clarification` correct. PubMed's esummary `references` (`Retraction in`,
  `Erratum in`, `Corrected and republished in`) and `pubtype` `Retracted Publication`. `entryCheck`
  in domain decides the outcome; `changed` compares title, issued, author family names,
  container-title and DOI where the source holds them.
- **The status** is `bibliography_entry_status` (0150), recorded under the entry's advisory lock;
  `notified` holds who was told of the outcome, and `bibliography_entry_told` (0152) who was told what
  and when, so a flap tells again only thirty days on. `bibliography_entry_attempt` (0152) holds each
  entry's last attempt, answered or not. The notification kind
  is `reference`, on the document, its counts the entry and outcome.
- **Check now** is `POST /v1/bibliography-entries/{id}/check`, needing edit on the entry and refused
  `entry_checked_recently` within a minute of its last attempt; the entry page shows the status, and
  Check now to an editor. **The sweep** is the worker's `recheckEntries`, once a UTC night from 02:00, with
  `CONNECTOR_REFERENCE_KEY`, which opens `/v1/reference`'s `check` alone. Each source's lane takes one
  entry from each tenant in turn at its rate, each source's due its own and longest since attempted
  first, so a failing one goes to the back; the budget is held per worker process, so two workers
  would each spend it.
- **Flags** ride the citation preview (`flags`), the entry listing and matches (`flag`), and
  `GET /v1/documents/{id}/flagged-sources`, Review's **Sources** panel. A publish request answers
  `warnings`, counts alone. The gate reads each placed component at its pin, else its latest.

## Built in XRc

- **The tools** are domain's `search_references` and `cite_reference`, in the assistant's tools and
  both conversations' (instructions `assistant-2`, `conversation-2`). Each runs as the person in the
  run's transaction, refused `reference_source_off` while the source is off; a search answers each
  result's title, authors, year, container and identifier as data.
- **A citation proposal** is an edit proposal (0151's `cites`, domain's `citedSourceSchema`: the
  source, identifier, CSL and when fetched) whose citation names `PENDING_ENTRY`, the nil UUID, in a
  paragraph after the words given or at its end. **Accepting** it, in the acceptance's transaction,
  takes the entry of the component's space the accepter may read obtained from the same source and
  identifier, else one matching by DOI or PubMed identifier, never by title, year and author alone;
  else makes one there, `obtained` the source, which needs the space's `edit` (`entry_not_writable`),
  then puts that id in the placeholder's place and accepts as any proposal is. It is never kept
  (`proposal_cites`): a suggestion holds no unresolved citation. The `proposal` event carries
  `cites { source, identifier, title }`, which the panel shows.
- **A run searches at most five times** (`REFERENCE_SEARCHES_PER_RUN`); past that the model is
  answered `reference_searches_spent`.
- **Left open**: a search's terms leave the product, so injected text could ask the model to search
  with the document's words; the tool's description forbids it, and nothing enforces it.

## Built in XRd

- **A reference extension** is an extension whose manifest's `kind` is `reference`, declaring
  `reference { search, fetch }`, paths under its endpoint, its `authentication` and `outbound`, and
  no settings or capabilities; a source manifest reads, and digests, as before. It installs, updates
  and is removed through the EX routes, and joins the tenant's sources as `ext:<extension id>`: the
  list, the switch, the Search tab, re-checks and the assistant's tools, whose `source` choices are
  the sources the tenant has on. A connection to one is refused.
- **Its secret** is the install's, set by an administrator of the environment at
  `PUT /v1/extensions/{id}/secret`, sealed by the connector (`/v1/reference/seal`,
  `reference-credential`) to the key and endpoint, kept in `extension_credential` (0152), the latest
  its own, with the endpoint it was set for. An update moving the endpoint needs it set again, and one
  dropping authentication sends none.
- **Its uses are its switch**: removal is refused `extension_in_use` while it is on. Removed, the
  entries obtained from it are untouched and no longer checked; Check now answers
  `reference_source_off`.
- **The call**: the service sends the installed manifest's endpoint and paths, and the sealed
  secret, in `/v1/reference`'s `extension`; the connector opens the secret for that key and endpoint
  alone and holds the call to XR-B's guard, the private ranges among it unless the deployment sets
  `CONNECTOR_REFERENCE_PRIVATE=allow`, as the suites do for their stand-in; Crossref and PubMed never
  take it. `search` sends `?query=`,
  `fetch` and `check` `?id=`; each answers a CSL-JSON list, admitted as an import is, each record by
  its `id`, a `fetch` or `check` keeping the one asked for alone; a 404 is no such record only where it
  answers `[]`, else a failure. A `check` reads `x-alloy-notices` (`{ kind, identifier?, date? }`) on the record; an
  extension giving none is never seen retracted. Each extension has a lane of its own in the sweep,
  one call a second.
- **Left open**: an extension's name is its own words, shown in the Search tab and never given to
  the model.

## Built in CLd

- **Supersession** (LIB-035) is a notice kind and the outcome `superseded`, flagged, told of and
  warned of at publish (`source_superseded`) as a correction is. Its vocabulary, confirmed against
  each source on 2026-10-31: Crossref's update types `new_version` and `new_edition` (its Crossmark
  schema's list; `update-to` items carry them as `type`), and its relation `is-replaced-by` (the
  schema's `isReplacedBy`, as the REST API names it, seen on a live work); PubMed's esummary
  `references` `reftype` `Update in` (MEDLINE's `CommentsCorrections` `UpdateIn`, the display form
  esummary answers, as `Retraction in` and `Erratum in` are). `Republished in` is not read as one. An extension may give
  `supersession` in `x-alloy-notices`. The stored outcome's checks, on the status and on who was told,
  are widened by 0175.
