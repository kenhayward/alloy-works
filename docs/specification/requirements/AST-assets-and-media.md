# AST - Assets and media

> **Status: v1, reviewed.**

## 1. Purpose

The binaries a space holds and content references: images, vector graphics, and whatever else
**AST-Q05** admits. This area owns ingest and validation, the intrinsic properties recorded from a
file, derivatives, versioning, rights, and deletion that respects what depends on an asset.

**The Tranche column carries two kinds of value**, as it does in every area: `T1` to `T6` are
delivery order from [`Project_Scope.md`](../Project_Scope.md) section 12, and `Constraint` marks a
requirement governing how something is built rather than naming a thing to build. A constraint has
no delivery position because it applies from the first line of code that could break it. The
convention is defined once in [the index](README.md#columns).

It exists as its own area because binaries carry concerns nothing else here does, and because
something now depends on getting one of them right: [STY](STY-styles-and-presentation-themes.md)
resolves an image style by deriving one dimension from the picture's own proportions, which requires
knowing them before publish time.

## 2. Depends on

| Rests on                                               | What it fixes                                                               |
| ------------------------------------------------------ | --------------------------------------------------------------------------- |
| [`Project_Scope.md`](../Project_Scope.md) §7.20        | The area's remit                                                            |
| [CNT](CNT-content-and-authoring.md) CNT-017, CNT-022   | Figures reference an asset; alt text is required                            |
| [STY](STY-styles-and-presentation-themes.md)           | Image styles need intrinsic dimensions                                      |
| [VER](VER-versioning-baselines-and-comparison.md)      | What a version is; a baseline pins what it must retrieve (VER-011, VER-023) |
| [REU](REU-reuse-variants-and-conditional-profiling.md) | Where a reused component - and so an asset - is used (REU-006)              |
| [PUB](PUB-publishing-and-output.md)                    | Publishing refuses without alternative text (PUB-033)                       |

| Not here                                     | There   |
| -------------------------------------------- | ------- |
| How large an image appears                   | **STY** |
| Where a figure sits and how it is numbered   | **STR** |
| Bibliography entries, terms and vocabularies | **LIB** |
| Who may read an asset                        | **IAM** |
| Rendering a credit line in output            | **PUB** |
| Storing bytes, and re-verifying them at rest | **ADM** |

## 3. Ingest

| ID          | Requirement                                                                                                                                                                                                   | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **AST-001** | An upload must be validated against a declared list of permitted formats, and anything not on it must be refused rather than stored                                                                           | Constraint | Specified |
| **AST-002** | Format must be determined from the file's content, never from its name or the type a client claims                                                                                                            | Constraint | Specified |
| **AST-003** | An upload must be scanned for malware before it can be referenced by anything                                                                                                                                 | Constraint | Specified |
| **AST-004** | A size limit must be declared per format, and a tenant must be able to lower it                                                                                                                               | T2         | Specified |
| **AST-005** | Ingest must record intrinsic properties: dimensions, resolution, colour space and page count where each applies, and duration only for a time-based format, which is admitted only if **AST-Q02** admits one  | T1         | Specified |
| **AST-006** | An asset whose intrinsic properties cannot be determined must be refused, because a style that cannot resolve is a failure deferred to publish                                                                | T1         | Specified |
| **AST-007** | Ingest must strip or preserve embedded metadata according to a declared policy, and must record which it did                                                                                                  | T2         | Specified |
| **AST-035** | An upload awaiting its scan (AST-003) must be in a named quarantined state, visible to the uploader, and must not be referenceable, listable as available, or usable by anything until it clears              | Constraint | Specified |
| **AST-036** | A scan that has not completed within a declared period must fail the upload rather than leaving it quarantined indefinitely, and the uploader must be told which happened either way                          | T2         | Specified |
| **AST-037** | An upload that fails its scan must be refused, must never become referenceable, and the refusal must be audited without retaining the file anywhere content could reach it                                    | Constraint | Specified |
| **AST-038** | The classes of file that may be an asset must be declared as a list, and a file outside it must be refused rather than stored as something content merely does not reference yet (AST-N03, **AST-Q05**)       | Constraint | Specified |
| **AST-040** | Ingest must validate what a file expands to, not only the bytes it arrives as: decoded dimensions, decompressed size and nesting depth must each be bounded, and a file exceeding any of them must be refused | Constraint | Specified |
| **AST-041** | Ingest must record a content hash of the original, and that hash must be what identifies the bytes thereafter - for duplicate detection (AST-029), for export, and for verifying what is stored               | Constraint | Specified |
| **AST-042** | A stored original must be verifiable against its hash on read, and re-verification on a schedule is the storage layer's (**ADM**). This area records the identity; storage keeps the promise                  | T2         | Specified |

**AST-002 is the requirement that stops an upload becoming an exploit.** A file named `.png` is not a
PNG, and a content type is whatever the client felt like sending.

**AST-040 is the same argument one layer in.** AST-004 bounds what arrives; a few hundred kilobytes
of PNG can decode to tens of gigabytes of pixels, and a zip-based format can nest. A size limit that
only counts bytes on the wire is a limit on the polite.

**AST-035 to AST-037 name the state an asset was already in and nobody had written down.** AST-003
says an upload cannot be referenced until it has been scanned, which means there is a period where
it exists and cannot be used - longer and more visible if **AST-Q03** sends scanning to a third
party. An uploader who is not told they are waiting will upload it again.

**AST-041 is load-bearing for three things that each assumed it.** Duplicate detection by content
(AST-029) needs an identity for the bytes; "a derivative must never be the only copy" (AST-010) is a
weaker promise if nobody can tell whether the original is intact; and an export is only checkable
against what it claims to contain if the claim is a hash.

**AST-007 covers two things that pull in opposite directions.** Embedded metadata can carry a
location, a device and a photographer, which may be a disclosure a report should not make - and it
can carry content credentials, which are provenance somebody may need. Declaring the policy and
recording what happened is what makes either defensible.

## 4. Derivatives

| ID          | Requirement                                                                                                                                                                                                                                                              | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **AST-008** | Thumbnails and preview renditions must be generated on ingest, not on demand                                                                                                                                                                                             | T2         | Specified |
| **AST-009** | Browsing a library must use derivatives, so that a list of a thousand images is not a thousand originals                                                                                                                                                                 | T2         | Specified |
| **AST-010** | A derivative must be regenerable from the original, and must never be the only copy of anything                                                                                                                                                                          | Constraint | Specified |
| **AST-011** | Format conversion for an output that cannot carry the original must be declared, and must be recorded on the publication                                                                                                                                                 | T3         | Specified |
| **AST-046** | Converting a format for an output that cannot carry the original (AST-011) is a modification for licensing purposes, and must be refused where the licence does not permit modification (AST-022)                                                                        | T3         | Specified |
| **AST-047** | A conversion that changes the content as well as the container - a wide-gamut image reduced to sRGB, a transparency flattened - must be declared and recorded on the publication in the same way, because the picture a reader sees is not the picture that was ingested | T3         | Specified |
| **AST-048** | A derivative must be discardable and rebuildable on demand from the original, which is what makes AST-010 worth having rather than a second permanent copy of everything                                                                                                 | T2         | Specified |
| **AST-049** | Replacing an original (AST-016) must rebuild or invalidate its derivatives, and a derivative of a superseded version must never be served for the version that replaced it                                                                                               | T2         | Specified |

**AST-046 makes a link that was there and unstated.** AST-011 treats conversion as an output
concern; a licence treats it as modification, and the two meet on the day a stock image with a
no-derivatives licence is published to a format that cannot carry its original encoding. **AST-047
is the case that does not look like conversion at all**: the format is unchanged, the colours are
not, and nobody recorded that the product decided it.

**AST-048 and AST-049 are the lifecycle AST-010 implied.** If a derivative can always be rebuilt,
it can always be thrown away - that is the storage argument for regenerability, and it was never
stated, so an implementation could keep every thumbnail for ever and still satisfy AST-010. AST-049
is the other end: a replaced original with a stale thumbnail is a picture that is wrong in the one
place everybody looks at first.

## 5. Alt text

| ID          | Requirement                                                                                                                                                                                                                                                                  | Tranche    | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **AST-012** | An asset must be able to carry default alternative text                                                                                                                                                                                                                      | T1         | Specified |
| **AST-013** | A figure placing an asset must be able to override it, because the same photograph means different things in two documents (**CNT-017**)                                                                                                                                     | T1         | Specified |
| **AST-014** | Publishing must fail where neither the asset nor the figure supplies alternative text (**CNT-022**, **PUB-033**)                                                                                                                                                             | Constraint | Specified |
| **AST-015** | An asset that is purely decorative must be markable as such, so that it can be correctly given no alternative text                                                                                                                                                           | T1         | Specified |
| **AST-039** | Default alternative text must carry the language it is written in, as a BCP 47 tag (**CNT-140**), so that it publishes as text in a known language (**CNT-084**). Where a figure overrides it (AST-013), the override takes the language of the component holding the figure | T1         | Specified |

**AST-039 was worth checking against CNT rather than assuming, and the check came back yes.**
CNT-083 makes language a property of content rather than of a reader, and CNT-084 carries it into
every output because tagged PDF and accessible Word both need the language of a passage. Alt text is
a passage. An asset reused across a French and an English document supplies its default in one
language, which is exactly why AST-013 lets the figure override it.

**AST-015 is not a loophole in AST-014.** Marking something decorative is a decision somebody made
and can be held to; leaving alt text empty is an omission nobody chose. Assistive technology needs
the difference, and so does an accessibility audit.

## 6. Versioning and use

| ID          | Requirement                                                                                                                                                                                                                                        | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **AST-016** | Replacing an asset must create a new version rather than overwriting it (**VER-011**)                                                                                                                                                              | Constraint | Specified |
| **AST-017** | A reference to an asset must be able to pin a version or float at latest, like any other reference                                                                                                                                                 | T2         | Specified |
| **AST-018** | Where an asset is used must be listable, across components, documents and baselines (**REU-006**)                                                                                                                                                  | T2         | Specified |
| **AST-019** | Deleting an asset must be refused while a baseline or publication depends on it (**VER-023**)                                                                                                                                                      | Constraint | Specified |
| **AST-020** | Deleting an asset used only by drafts must warn and name them                                                                                                                                                                                      | T2         | Specified |
| **AST-031** | An asset version must state what it covers. The binary is versioned; the recorded properties - default alternative text, source, licence and permitted uses - must each carry their own history of what changed, when, and who changed it          | T2         | Specified |
| **AST-032** | A change to an asset's licence or to what it permits must be surfaced wherever the asset is used, as an expiry is (AST-025), and must never reach a reference floating at latest (AST-017) without being visible                                   | T3         | Specified |
| **AST-033** | Superseded asset versions must be retained and retrievable, together with the relationships between them: what replaced what, when, and why                                                                                                        | Constraint | Specified |
| **AST-034** | A superseded version must not be separately deletable. Retention follows the asset and the retention policy over it (**LIF**), so that a version nothing currently references does not quietly become unavailable to an inspection that asks later | Constraint | Specified |

**AST-031 and AST-032 answer "what exactly is versioned", which review found unstated.** Versioning
the binary alone leaves a re-licence invisible: the picture is identical, what may be done with it is
not, and a reference floating at latest picks the change up without anybody being told. The rights
data moves with its own history, and a change to it is surfaced like an expiry rather than applied
quietly.

**AST-033 and AST-034 give an orphaned old version a stated fate, which is: it stays.** AST-019
protects a version something depends on today. The question review asked is about the one nothing
depends on any more, and the answer this market forces is that it is kept - a report issued three
years ago used a particular picture, and "which one" has to remain answerable after every document
that referenced it has moved on.

## 7. Rights and provenance

| ID          | Requirement                                                                                                                                                                                                                                              | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **AST-021** | An asset must record its source and the licence it is held under                                                                                                                                                                                         | T3         | Specified |
| **AST-022** | A licence must be able to declare what it permits: internal use, publication, redistribution, modification                                                                                                                                               | T3         | Specified |
| **AST-023** | Publishing must be refused where an asset's licence does not permit the use being made of it, and must say which asset and which licence                                                                                                                 | T3         | Specified |
| **AST-024** | An asset carrying content credentials must have them preserved or deliberately removed, and which happened must be recorded                                                                                                                              | T3         | Specified |
| **AST-025** | An expiry date must be recordable on a licence, and content past it must be surfaced wherever the asset is used                                                                                                                                          | T3         | Specified |
| **AST-043** | An asset with no recorded source or licence (AST-021) must be treated as internal use only: publishing it must be refused on the same terms as an asset whose licence forbids the use (AST-023), rather than proceeding because nothing was written down | Constraint | Specified |
| **AST-044** | Upload must ask for the source and licence declaration, and where it is not given must record its absence explicitly, so that undeclared assets are listable rather than indistinguishable from declared ones                                            | T3         | Specified |
| **AST-045** | A licence must be able to declare that it requires attribution, and what that attribution must say. Whether the credit line is rendered, and where, is **PUB**'s (**AST-Q06**)                                                                           | T3         | Specified |

**AST-043 closes the gap the rest of section 7 left open.** AST-021 records a licence and AST-023
enforces one, so an asset with no licence at all passed both - the enforcement had nothing to refuse.
Defaulting silence to internal-use-only is the only safe direction: the cost of being wrong is a
publish that has to be unblocked by somebody declaring a licence, against an infringement that has
already shipped. Whether enforcement blocks or warns is still **AST-Q04**, and this requirement
inherits whatever that decides.

**AST-045 adds the dimension most stock and Creative Commons licences actually carry.** "Internal
use, publication, redistribution, modification" describes what may be done; a great many licences
also require that something be said. Recording it here is cheap and the data has nowhere else to
live.

**Section 7 is unglamorous and is a real liability.** A stock photograph licensed for internal use
that reaches a published client report is an infringement the customer will attribute to whoever
made publishing easy.

## 8. Organisation

| ID          | Requirement                                                                                                                                                                     | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **AST-026** | Assets must belong to a space and must be permissioned by it (**IAM**)                                                                                                          | T2      | Specified |
| **AST-027** | Assets must be searchable by name, caption, alt text, format and metadata (**SCH**)                                                                                             | T2      | Specified |
| **AST-028** | An asset library must be browsable visually, with filters                                                                                                                       | T2      | Specified |
| **AST-029** | A duplicate upload should be detected by content, and the uploader offered the existing asset                                                                                   | T3      | Specified |
| **AST-030** | Assets must be exportable with their metadata, and importable the same way (**IMP**)                                                                                            | T2      | Specified |
| **AST-050** | Assets that nothing references - no component, no document, no baseline (AST-018) - must be listable, so that a library can be tidied deliberately rather than growing silently | T3      | Specified |

## 9. Non-requirements

| ID          | Not this                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| **AST-N01** | **Not a digital asset management product.** This manages the assets used in documents, not a media library for a business |
| **AST-N02** | **No image editing.** Cropping, retouching and annotating happen elsewhere; an asset arrives finished                     |
| **AST-N03** | **No arbitrary file storage.** An asset is something content references, not an attachment locker                         |
| **AST-N04** | **No embedding of an original where a derivative will do**, and no derivative that cannot be regenerated                  |

## 10. Open questions

| ID          | Question                                                                                                                                                                                                                 | What would settle it                                                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AST-Q01** | **Which formats are permitted (AST-001)?** SVG in particular is a document format that can carry script, and refusing it costs real capability                                                                           | A security decision: sanitise SVG on ingest, or rasterise it, or refuse it                                                                                                                                          |
| **AST-Q02** | **Are video and audio in scope at all?** They have no place in a PDF and an obvious one in an HTML reading view                                                                                                          | Whether HTML output becomes a real reading format                                                                                                                                                                   |
| **AST-Q03** | **Where does malware scanning happen (AST-003)?** A third-party service is the usual answer and it means uploads leave the tenant boundary                                                                               | A decision with **IAM**, and a customer with data residency requirements will force it                                                                                                                              |
| **AST-Q04** | **Does licence enforcement (AST-023) block or warn?** Blocking a publish over a metadata field somebody forgot will not be popular                                                                                       | Whether customers treat asset licensing as a control or as a record                                                                                                                                                 |
| **AST-Q05** | **Which classes of file are assets (AST-038)?** The purpose said "embedded objects", which is wider than anything the requirements describe, and AST-N03 rules out an attachment locker without saying where the line is | A decision taken with **AST-Q01** and **AST-Q02**, which each move it. Raster images and vector graphics are in; a spreadsheet a figure embeds, a CAD drawing, a PDF placed as a page are each a separate yes or no |
| **AST-Q06** | **Who renders an attribution required by a licence (AST-045)?** Recording the requirement is this area's; a credit line under a figure, in a list of illustrations, or in a colophon is a layout decision                | A decision with **PUB** and **STY**. The requirement to record it does not wait on the answer                                                                                                                       |

## 11. Traceability

| This document      | Rests on                                                                      |
| ------------------ | ----------------------------------------------------------------------------- |
| Section 1          | Scope §7.20, from the ownership pass                                          |
| AST-005, AST-006   | STY-015 to STY-019 - image styles need intrinsic dimensions                   |
| AST-012 to AST-015 | CNT-017, CNT-022, PUB-033 - alt text as a publish-time failure                |
| AST-019            | VER-023 - a baseline pins what it must be able to retrieve                    |
| AST-024            | Scope §7.20 content credentials                                               |
| AST-016, AST-019   | VER-011, VER-023 - versioning and what a baseline pins                        |
| AST-018            | REU-006 - where a reused thing is used                                        |
| AST-039            | CNT-140, CNT-084 - language is a property of content, carried to every output |
| AST-031 to AST-050 | [The v1 review](<../../reviews/AST - Assets and media.md>); section 12        |

## 12. Change history

One row per change, against [the review](<../../reviews/AST - Assets and media.md>) that prompted
it. The rules for what gets a new identifier are in
[the index](README.md#how-a-requirement-is-written).

### Ambiguities the review asked to resolve

| Point                                         | Change                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Tranche column mixes two axes             | **The convention is defined**, in [the index](README.md#columns), and the review is right that a reader of one document could not know that. A legend now says it in section 1: T1 to T6 are delivery order, `Constraint` has no delivery position because it applies from the first line of code that could break it |
| "Rests on" is not exhaustive                  | Rows added for **VER** (VER-011, VER-023), **REU** (REU-006) and **PUB** (PUB-033), which were load-bearing and cited inline. Traceability rows to match                                                                                                                                                              |
| Versioning granularity is unstated            | **AST-031** (the binary is versioned; alt text, source, licence and permitted uses each carry their own history) and **AST-032** (a licence change is surfaced wherever the asset is used, and never reaches a floating reference invisibly)                                                                          |
| The fate of a superseded version              | **AST-033** (superseded versions and the relationships between them are retained and retrievable for inspection) and **AST-034** (a superseded version is not separately deletable; retention follows the asset, under **LIF**)                                                                                       |
| The quarantine state does not exist           | **AST-035** (a named quarantined state, visible to the uploader, referenceable by nothing), **AST-036** (a scan that does not finish in a declared period fails the upload rather than hanging), **AST-037** (a failed scan is refused and audited, and the file never becomes reachable)                             |
| "duration" in AST-005 reaches into AST-Q02    | **Gated.** AST-005 now records duration only for a time-based format, and admits one only if AST-Q02 does, so a T1 implementation does not build for formats the platform may never take                                                                                                                              |
| "embedded objects" outstrips the requirements | The purpose no longer claims them. **AST-038** requires the classes of file that may be an asset to be declared as a list, and **AST-Q05** is where the line gets drawn - it moves with AST-Q01 and AST-Q02                                                                                                           |
| Alt text language                             | **Checked against CNT rather than assumed, and the answer is yes.** **AST-039**: default alt text carries its language (CNT-083) and publishes with it (CNT-084); a figure's override takes the language of the component                                                                                             |

### Missing within the declared remit

| Gap                         | Change                                                                                                                                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decoded-size validation     | **AST-040**: decoded dimensions, decompressed size and nesting depth each bounded and refused. AST-004 bounded only what arrives, which is a limit on the polite                                                                                      |
| Integrity of originals      | **AST-041** (a content hash recorded at ingest, and the identity everything else uses) and **AST-042**, which states the boundary once: this area records the identity, the storage layer re-verifies on a schedule (**ADM**)                         |
| Unknown-licence posture     | **AST-043**: no recorded source or licence means internal use only, and publishing is refused. **AST-044**: upload asks, and records the absence explicitly so undeclared assets are listable. Whether enforcement blocks or warns stays AST-Q04      |
| Attribution as a permission | **AST-045**: a licence can require attribution and say what it must say. Rendering the credit line is **PUB**'s, and **AST-Q06** asks who exactly                                                                                                     |
| Conversion as modification  | **AST-046** makes the link explicit: converting a format is a modification, refused where the licence forbids one. **AST-047** covers the case that does not look like conversion - a wide-gamut image reduced to sRGB is a change of content         |
| Derivative lifecycle        | **AST-048** (derivatives may be discarded and rebuilt, which is the storage payoff AST-010 implied but never stated) and **AST-049** (replacing an original rebuilds or invalidates them, and a stale derivative is never served for the new version) |
| Orphan surfacing            | **AST-050**: assets nothing references are listable, so a library is tidied deliberately rather than growing silently                                                                                                                                 |

### Counts

|                  | Before | After |
| ---------------- | ------ | ----- |
| Requirements     | 30     | 50    |
| Non-requirements | 4      | 4     |
| Open questions   | 4      | 6     |

### From the cross-cutting review

A later review read all twenty-one documents against each other. Its sections are answered in
[XXX - Response.md](<../../reviews/XXX - Response.md>); what changed here:

| Review sections | Change                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1.3           | AST-039 and its traceability row now cite **CNT-140** - the BCP 47 tag - rather than superseded CNT-083, and the row's identifier typo is corrected |
