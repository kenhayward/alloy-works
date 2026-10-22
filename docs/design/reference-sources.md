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
differ, and any retraction or correction the source reports, in the entry's **status** beside it,
never a version. A retracted or corrected entry is flagged on every citation of it, in the editor and
in the document's Review, and the document's owner is told. A workflow transition may require **No
retracted sources cited**. The assistant can search a source and propose a citation as the person
asking.

## Requirements owned

| ID          | How it is met                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LIB-031** | The Cite dialog's **Search** tab queries a configured source and inserts a citation from a result, matched or made as an entry                          |
| **LIB-032** | Sources are a declared, versioned list in domain; a further one is an extension of kind `reference`                                                     |
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
`current`, `changed`, `gone`, `retracted`, `corrected`; `differs` the CSL variables whose values the
source now holds otherwise; `notice` the retraction or correction's identifier and date. It is the
system's word about an entry, so it is written without a version; the entry's own fields change only
when a person takes a new version.

## Who is told

A document's review owner, else the person who made it, else the space's administrators, skipping
anyone erased or disabled; once per entry, outcome and person, in the inbox. A reader who cannot read
an entry sees a citation's flag, never the entry.

## The gate

**No retracted sources cited** counts the retracted entries the components a document places at the
version moving cite, read by the system so every actor gets one answer; a correction warns.

| Left unclaimed | Why                                                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| LIB-035        | Re-checked against its source - resolves, fields, retraction and correction - but neither built-in source reports a supersession; an extension may |

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
- **The status** is `bibliography_entry_status` (0150); `notified` holds who was told of the outcome
  and is emptied when it changes, so current then retracted again tells again. The notification kind
  is `reference`, on the document, its counts the entry and outcome.
- **Check now** is `POST /v1/bibliography-entries/{id}/check`, a read of the entry; the entry page
  shows the status. **The sweep** is the worker's `recheckEntries`, once a UTC night from 02:00, with
  `CONNECTOR_REFERENCE_KEY`, which opens `/v1/reference`'s `check` alone. Each source's lane takes one
  entry from each tenant in turn at its rate; the budget is held per worker process, so two workers
  would each spend it.
- **Flags** ride the citation preview (`flags`), the entry listing and matches (`flag`), and
  `GET /v1/documents/{id}/flagged-sources`, Review's **Sources** panel. A publish request answers
  `warnings`, counts alone. The gate reads each placed component at its pin, else its latest.
