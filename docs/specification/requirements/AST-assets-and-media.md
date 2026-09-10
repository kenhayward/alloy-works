# AST - Assets and media

> **Status: draft, for review.**

## 1. Purpose

The binaries a space holds and content references: images, vector graphics, embedded objects. This
area owns ingest and validation, the intrinsic properties recorded from a file, derivatives,
versioning, rights, and deletion that respects what depends on an asset.

It exists as its own area because binaries carry concerns nothing else here does, and because
something now depends on getting one of them right: [STY](STY-styles-and-presentation-themes.md)
resolves an image style by deriving one dimension from the picture's own proportions, which requires
knowing them before publish time.

## 2. Depends on

| Rests on                                             | What it fixes                                    |
| ---------------------------------------------------- | ------------------------------------------------ |
| [`Project_Scope.md`](../Project_Scope.md) §7.20      | The area's remit                                 |
| [CNT](CNT-content-and-authoring.md) CNT-017, CNT-022 | Figures reference an asset; alt text is required |
| [STY](STY-styles-and-presentation-themes.md)         | Image styles need intrinsic dimensions           |

| Not here                                     | There   |
| -------------------------------------------- | ------- |
| How large an image appears                   | **STY** |
| Where a figure sits and how it is numbered   | **STR** |
| Bibliography entries, terms and vocabularies | **LIB** |
| Who may read an asset                        | **IAM** |

## 3. Ingest

| ID          | Requirement                                                                                                                                    | Tranche    | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **AST-001** | An upload must be validated against a declared list of permitted formats, and anything not on it must be refused rather than stored            | Constraint | Specified |
| **AST-002** | Format must be determined from the file's content, never from its name or the type a client claims                                             | Constraint | Specified |
| **AST-003** | An upload must be scanned for malware before it can be referenced by anything                                                                  | Constraint | Specified |
| **AST-004** | A size limit must be declared per format, and a tenant must be able to lower it                                                                | T2         | Specified |
| **AST-005** | Ingest must record intrinsic properties: dimensions, resolution, colour space, page count, duration where each applies                         | T1         | Specified |
| **AST-006** | An asset whose intrinsic properties cannot be determined must be refused, because a style that cannot resolve is a failure deferred to publish | T1         | Specified |
| **AST-007** | Ingest must strip or preserve embedded metadata according to a declared policy, and must record which it did                                   | T2         | Specified |

**AST-002 is the requirement that stops an upload becoming an exploit.** A file named `.png` is not a
PNG, and a content type is whatever the client felt like sending.

**AST-007 covers two things that pull in opposite directions.** Embedded metadata can carry a
location, a device and a photographer, which may be a disclosure a report should not make - and it
can carry content credentials, which are provenance somebody may need. Declaring the policy and
recording what happened is what makes either defensible.

## 4. Derivatives

| ID          | Requirement                                                                                                              | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **AST-008** | Thumbnails and preview renditions must be generated on ingest, not on demand                                             | T2         | Specified |
| **AST-009** | Browsing a library must use derivatives, so that a list of a thousand images is not a thousand originals                 | T2         | Specified |
| **AST-010** | A derivative must be regenerable from the original, and must never be the only copy of anything                          | Constraint | Specified |
| **AST-011** | Format conversion for an output that cannot carry the original must be declared, and must be recorded on the publication | T3         | Specified |

## 5. Alt text

| ID          | Requirement                                                                                                                              | Tranche    | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **AST-012** | An asset must be able to carry default alternative text                                                                                  | T1         | Specified |
| **AST-013** | A figure placing an asset must be able to override it, because the same photograph means different things in two documents (**CNT-017**) | T1         | Specified |
| **AST-014** | Publishing must fail where neither the asset nor the figure supplies alternative text (**CNT-022**, **PUB-033**)                         | Constraint | Specified |
| **AST-015** | An asset that is purely decorative must be markable as such, so that it can be correctly given no alternative text                       | T1         | Specified |

**AST-015 is not a loophole in AST-014.** Marking something decorative is a decision somebody made
and can be held to; leaving alt text empty is an omission nobody chose. Assistive technology needs
the difference, and so does an accessibility audit.

## 6. Versioning and use

| ID          | Requirement                                                                                        | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **AST-016** | Replacing an asset must create a new version rather than overwriting it (**VER-011**)              | Constraint | Specified |
| **AST-017** | A reference to an asset must be able to pin a version or float at latest, like any other reference | T2         | Specified |
| **AST-018** | Where an asset is used must be listable, across components, documents and baselines (**REU-006**)  | T2         | Specified |
| **AST-019** | Deleting an asset must be refused while a baseline or publication depends on it (**VER-023**)      | Constraint | Specified |
| **AST-020** | Deleting an asset used only by drafts must warn and name them                                      | T2         | Specified |

## 7. Rights and provenance

| ID          | Requirement                                                                                                                              | Tranche | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **AST-021** | An asset must record its source and the licence it is held under                                                                         | T3      | Specified |
| **AST-022** | A licence must be able to declare what it permits: internal use, publication, redistribution, modification                               | T3      | Specified |
| **AST-023** | Publishing must be refused where an asset's licence does not permit the use being made of it, and must say which asset and which licence | T3      | Specified |
| **AST-024** | An asset carrying content credentials must have them preserved or deliberately removed, and which happened must be recorded              | T3      | Specified |
| **AST-025** | An expiry date must be recordable on a licence, and content past it must be surfaced wherever the asset is used                          | T3      | Specified |

**Section 7 is unglamorous and is a real liability.** A stock photograph licensed for internal use
that reaches a published client report is an infringement the customer will attribute to whoever
made publishing easy.

## 8. Organisation

| ID          | Requirement                                                                                   | Tranche | Status    |
| ----------- | --------------------------------------------------------------------------------------------- | ------- | --------- |
| **AST-026** | Assets must belong to a space and must be permissioned by it (**IAM**)                        | T2      | Specified |
| **AST-027** | Assets must be searchable by name, caption, alt text, format and metadata (**SCH**)           | T2      | Specified |
| **AST-028** | An asset library must be browsable visually, with filters                                     | T2      | Specified |
| **AST-029** | A duplicate upload should be detected by content, and the uploader offered the existing asset | T3      | Specified |
| **AST-030** | Assets must be exportable with their metadata, and importable the same way (**IMP**)          | T2      | Specified |

## 9. Non-requirements

| ID          | Not this                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| **AST-N01** | **Not a digital asset management product.** This manages the assets used in documents, not a media library for a business |
| **AST-N02** | **No image editing.** Cropping, retouching and annotating happen elsewhere; an asset arrives finished                     |
| **AST-N03** | **No arbitrary file storage.** An asset is something content references, not an attachment locker                         |
| **AST-N04** | **No embedding of an original where a derivative will do**, and no derivative that cannot be regenerated                  |

## 10. Open questions

| ID          | Question                                                                                                                                       | What would settle it                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **AST-Q01** | **Which formats are permitted (AST-001)?** SVG in particular is a document format that can carry script, and refusing it costs real capability | A security decision: sanitise SVG on ingest, or rasterise it, or refuse it             |
| **AST-Q02** | **Are video and audio in scope at all?** They have no place in a PDF and an obvious one in an HTML reading view                                | Whether HTML output becomes a real reading format                                      |
| **AST-Q03** | **Where does malware scanning happen (AST-003)?** A third-party service is the usual answer and it means uploads leave the tenant boundary     | A decision with **IAM**, and a customer with data residency requirements will force it |
| **AST-Q04** | **Does licence enforcement (AST-023) block or warn?** Blocking a publish over a metadata field somebody forgot will not be popular             | Whether customers treat asset licensing as a control or as a record                    |

## 11. Traceability

| This document      | Rests on                                                       |
| ------------------ | -------------------------------------------------------------- |
| Section 1          | Scope §7.20, from the ownership pass                           |
| AST-005, AST-006   | STY-015 to STY-019 - image styles need intrinsic dimensions    |
| AST-012 to AST-015 | CNT-017, CNT-022, PUB-033 - alt text as a publish-time failure |
| AST-019            | VER-023 - a baseline pins what it must be able to retrieve     |
| AST-024            | Scope §7.20 content credentials                                |
