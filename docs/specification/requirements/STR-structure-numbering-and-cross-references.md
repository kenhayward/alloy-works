# STR - Structure, numbering and cross-references

> **Status: v1, reviewed.**

## 1. Purpose

Where content sits in a document, and everything positional that follows from it. This area owns the
outline, the numbering computed over it, the cross-references resolved against it, and the
navigation built from it.

It exists because of a rule stated in [CNT](CNT-content-and-authoring.md): **a component does not
know where it is used.** Everything a component cannot know - its heading number, its figure numbers,
what "see section 4.2" resolves to - is known here instead, and only in the context of one document.
That is what lets the same component be section 2 of one report and section 7.3 of another.

## 2. Depends on

| Rests on                                           | What it fixes                                                                |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| [CNT](CNT-content-and-authoring.md)                | Content carries no position; caption-bearing blocks carry identity (CNT-081) |
| [`Project_Scope.md`](../Project_Scope.md) §6, §7.2 | Outline, section, component reference; the intent this makes precise         |

| Not here                                                    | There                                                                        |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| What a component contains                                   | **CNT**                                                                      |
| Whether a reference is pinned or floating, and reuse itself | **REU**, **VER**                                                             |
| Declaring the numbering scheme and rendering the numbers    | **PUB**                                                                      |
| The catalogue a caption's style comes from                  | **STY**                                                                      |
| A template's starting outline                               | **TPL**                                                                      |
| Who may reorder an outline                                  | **IAM**                                                                      |
| Two editors moving the same node at once                    | Here, STR-059; **COL** holds the component lock and **API** the precondition |

## 3. The outline

A document owns exactly one outline: an ordered tree whose nodes are either **sections** or
**component references**. A section is structural and belongs to this document alone. A component
reference points at content that may be shared with any number of other documents.

That asymmetry is the whole design. Sections carry position; components carry meaning; and the two
are separable precisely because a section is never reused.

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                 | Tranche    | Status                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------- |
| **STR-001** | A document must have exactly one outline, and it must be an ordered tree                                                                                                                                                                                                                                                                                                                                                                    | T1         | Specified             |
| **STR-002** | Every outline node must be either a section or a component reference                                                                                                                                                                                                                                                                                                                                                                        | T1         | Specified             |
| **STR-003** | Every outline node must carry a stable identifier, allocated on creation and never reused                                                                                                                                                                                                                                                                                                                                                   | T1         | Specified             |
| **STR-004** | A section must exist only in the document that declares it. Sections must not be shareable or reusable                                                                                                                                                                                                                                                                                                                                      | Constraint | Specified             |
| **STR-005** | A section must carry a title, and must be able to carry metadata of its own                                                                                                                                                                                                                                                                                                                                                                 | T1         | Specified             |
| **STR-006** | The outline must be editable by pointer, by keyboard alone, and through the API                                                                                                                                                                                                                                                                                                                                                             | T1         | Specified             |
| **STR-007** | The outline must support nesting to at least nine levels                                                                                                                                                                                                                                                                                                                                                                                    | T1         | Specified             |
| **STR-008** | Moving a node must move its entire subtree, and must be a single undoable action                                                                                                                                                                                                                                                                                                                                                            | T1         | Specified             |
| **STR-009** | A component reference must record whether it is pinned to a version or revision, or floating at latest (**REU** and **VER** own the model)                                                                                                                                                                                                                                                                                                  | T1         | Superseded by STR-058 |
| **STR-010** | The same component must be referenceable more than once in one outline, and each occurrence must be a distinct node with its own identity                                                                                                                                                                                                                                                                                                   | T4         | Specified             |
| **STR-011** | An outline must not be able to contain itself, directly or through any chain of references, and the check must run before the cycle is stored                                                                                                                                                                                                                                                                                               | T1         | Superseded by STR-057 |
| **STR-012** | The outline must be versioned with the document, and pinned by a baseline like anything else (**VER**)                                                                                                                                                                                                                                                                                                                                      | T1         | Specified             |
| **STR-058** | A component reference must record which of the three reference modes it takes - pinned, floating at latest, or tracking the latest approved revision (**REU-050**, **LIF-038**)                                                                                                                                                                                                                                                             | T1         | Specified             |
| **STR-059** | Concurrent outline edits must be governed by a version precondition (**API-037**) and by conflict detection in the interface: a conflicting reorder, insert or removal must be refused or surfaced against the current outline, and must never silently overwrite another person's structural change. Component locks (**COL-005**) continue to govern the content a node points at, and no document-level lock is introduced (**COL-N02**) | Constraint | Specified             |
| **STR-057** | The graph of component references reachable from a document's outline must be acyclic: no document may contain itself through any chain of component references, and the check must run before an edit is stored (**REU-044** is the same rule from the reuse side)                                                                                                                                                                         | Constraint | Specified             |
| **STR-053** | An outline node's identifier must be unique within the tenant rather than within its document, so that a reference across documents cannot collide (**STR-Q02** may widen what references one, never what identity means)                                                                                                                                                                                                                   | Constraint | Specified             |
| **STR-054** | An outline must have an implicit root - the document itself - which carries the document's own identity and deep link (STR-044), and must be allowed to hold no nodes at all. An empty outline is a valid document (**PUB-079**), not an error                                                                                                                                                                                              | T1         | Specified             |

**STR-059 answers a question that was delegated to a document which does not own it.** The boundary
table sent concurrent outline edits to **COL**, and COL holds locks per component and explicitly
declines document-level locking - so nothing described what happens when two people reorder the same
outline. The answer needs no new lock: a precondition at the API, conflict detection in the
interface, and the component lock still doing its own job.

**STR-057 says which graph the cycle check walks.** STR-011 said an outline "must not contain
itself", which is loose for what is actually a reachability check across chains of component
references - a contains b, b contains c, c contains a. Naming the graph is what makes the check
implementable and what lets **REU-044** state the same rule from the other side without the two
drifting apart.

**STR-054 answers two questions that only look like edge cases.** A deep link at top level needs
something to address, and a document whose outline is empty has to be either valid or refused - both
are defensible, and silence meant the first test suite would decide. It is valid, it publishes its
front matter, and its root is the document.

**STR-010 is small to write and awkward everywhere else.** A component used twice in one report is
two figures, two numbers and two cross-reference targets. If the occurrence has no identity of its
own, a reference to "the second one" cannot be expressed, and numbering has nothing to hang on.

## 4. Numbering

Numbering is computed, never stored. It is a pure function of the outline, the publishing layout's
declared schemes, and the conditions in force - which means it can be recomputed at any time and must
never be authored.

| ID          | Requirement                                                                                                                                                                                                                                                                                                  | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **STR-013** | Numbering schemes must be declared by the publishing layout, and applied here (**PUB** owns the declaration)                                                                                                                                                                                                 | T1         | Specified |
| **STR-014** | Sections, figures, tables and equations must each be numbered in an independent sequence, and the layout must be able to declare further sequences                                                                                                                                                           | T1         | Specified |
| **STR-015** | A sequence must be able to restart at a declared outline depth - per chapter, per part - rather than running continuously                                                                                                                                                                                    | T1         | Specified |
| **STR-016** | Appendices must be numberable in their own scheme, with their own restarting sub-sequences                                                                                                                                                                                                                   | T1         | Specified |
| **STR-017** | A node must be able to be excluded from numbering without consuming a number from its sequence                                                                                                                                                                                                               | T1         | Specified |
| **STR-018** | Numbering must be deterministic: the same outline, layout and conditions must always produce the same numbers                                                                                                                                                                                                | Constraint | Specified |
| **STR-019** | Numbering must never be stored in content, and must be recomputed whenever the outline, the layout or the conditions change                                                                                                                                                                                  | Constraint | Specified |
| **STR-020** | Content excluded by a condition must consume no number (**REU** owns the evaluation)                                                                                                                                                                                                                         | T4         | Specified |
| **STR-021** | Where one component is referenced twice, each occurrence must be numbered independently                                                                                                                                                                                                                      | T4         | Specified |
| **STR-022** | Every number the reader sees must be traceable to the node that produced it, so that a wrong number can be diagnosed rather than guessed at                                                                                                                                                                  | T1         | Specified |
| **STR-051** | Numbering must be computed only over content that survives condition evaluation, and cross-references must be resolved only over content that has been numbered. The order is one constraint rather than three consequences of it (STR-020, STR-030, STR-042, **REU-028** to **REU-030**)                    | Constraint | Specified |
| **STR-052** | The numbering of a baseline must be reproducible from that baseline's pinned inputs - its outline, its layout version and its profile (**VER-018**, **REU-040**) - and a publication must record the numbers it published, so that a section number cited outside the product can still be found years later | Constraint | Specified |

**STR-051 makes the spine of this document normative.** "Conditions first, numbering second" was
stated twice as commentary and enforced in three places that each assumed it; a future requirement
could have assumed the opposite without contradicting anything. One constraint anchors it.

**STR-052 is the drift review found, and it is the failure this market notices.** Numbering is
recomputed rather than stored, which is right - and it means an edit between baseline 3 and baseline
4 can move the "section 4.2" that a companion filing already cites on paper. Reproducibility from the
baseline's pinned inputs is what makes the old number recoverable, and recording what was published
is what makes it findable. It needs the profile pinned as well as the outline and the layout, which
is why REU-040 and VER-018 are both cited.

**STR-020 is the one that catches people.** If a conditional figure is excluded for one audience and
still consumes figure number 4, that audience reads a report whose figures jump from 3 to 5. The
resolution order therefore has to be conditions first, numbering second - which also means a document
has as many correct numberings as it has profiles, and none of them can be stored.

## 5. Captions

| ID          | Requirement                                                                                                                       | Tranche | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **STR-023** | Every caption-bearing block (CNT-081) must be numbered in the sequence for its kind                                               | T1      | Specified |
| **STR-024** | A caption's text must come from the component; its label and number - "Figure 3" - must come from the layout and be computed here | T1      | Specified |
| **STR-025** | Caption placement relative to its block must be a property of the style, not of the content (**STY**)                             | T1      | Specified |

## 6. Cross-references

| ID          | Requirement                                                                                                                                                                                                                                          | Tranche    | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **STR-026** | A cross-reference must target an outline node, a caption-bearing block, a footnote, or a bibliography entry, by identity                                                                                                                             | T1         | Specified |
| **STR-027** | The display form must be selectable: number, title, number and title, page, or a relative form such as "above" or "below"                                                                                                                            | T1         | Specified |
| **STR-028** | A cross-reference must resolve in the context of the document doing the resolving, never in the component that contains it                                                                                                                           | T1         | Specified |
| **STR-029** | A cross-reference whose target is not present in the resolving document must fail the publish with a named error identifying both the reference and its target                                                                                       | T1         | Specified |
| **STR-030** | A cross-reference whose target is excluded by a condition must fail the publish, and must never render as a blank, a zero, or the word "error"                                                                                                       | T4         | Specified |
| **STR-031** | Cross-references must resolve afresh whenever the outline changes; a stale number must not be renderable                                                                                                                                             | T1         | Specified |
| **STR-032** | A cross-reference must be able to target something in the same component and something in another component of the same document                                                                                                                     | T1         | Specified |
| **STR-033** | The author must be able to see, for any node, what references it - so that deleting something referenced is a warning rather than a discovery at publish time                                                                                        | T3         | Specified |
| **STR-056** | A cross-reference to something in its own component must target the nodes of its own occurrence: a component referenced twice resolves "see Figure 2" against the occurrence the reader is in (STR-010, STR-021)                                     | Constraint | Specified |
| **STR-055** | A cross-reference whose display form is a page (STR-027) must render a declared alternative form in an output format that has no pages, and must fail the publish where none is declared - never a blank, and never a page number that means nothing | T1         | Specified |

**STR-056 states something two requirements implied and neither said.** A component containing "see
Figure 2" resolves differently as the first occurrence and as the second, which follows from STR-010
and STR-021 and is subtle enough that two implementers would disagree about it.

**STR-055 closes an asymmetry with STR-050.** A page break in a format with no pages is ignored
without error, deliberately; a cross-reference whose display form is a page had no such rule and
would have fallen between STR-027 and STR-030. A break is decoration a format can drop, and a page
reference is a sentence pointing somewhere - so it degrades to a declared form or fails, and never
prints a number that means nothing.

**STR-030 is the same failure as STR-020 wearing different clothes.** A reference to a section that
this audience does not receive is not a formatting problem; it is a document that tells a reader to
consult something they do not have. Failing the publish is the only honest option, and it is why
conditions have to be resolved before references rather than after.

## 7. Navigation on screen

| ID          | Requirement                                                                                                                                                                      | Tranche | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **STR-034** | A navigable table of contents must reflect the live outline, and must update as the outline changes                                                                              | T1      | Specified |
| **STR-035** | The table of contents must track the reader's position as they scroll, and must let them jump to any node                                                                        | T1      | Specified |
| **STR-036** | The table of contents must show numbering as it will publish, so that an author is never guessing what a section will be called                                                  | T1      | Specified |
| **STR-037** | An author must be able to reorder the outline from the table of contents directly                                                                                                | T1      | Specified |
| **STR-038** | The table of contents must surface state that matters to an author: which components are locked (**COL**), which references are unresolved, which bindings (**DAT**) have failed | T3      | Specified |
| **STR-039** | Navigation must remain usable on a document of several hundred nodes, against the budget in scope §11                                                                            | T1      | Specified |

## 8. Generated lists in published output

| ID          | Requirement                                                                                                     | Tranche | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **STR-040** | A table of contents must be generatable to a declared depth (**PUB** renders it; the structure comes from here) | T1      | Specified |
| **STR-041** | A list of figures, a list of tables and a list of equations must each be generatable                            | T1      | Specified |
| **STR-042** | Generated lists must contain only what the resolved document contains, after conditions are applied             | T4      | Specified |
| **STR-043** | An index should be generatable from marked index entries                                                        | T6      | Specified |

## 9. Deep links

| ID          | Requirement                                                                                                         | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **STR-044** | Every outline node must have a stable, shareable URL                                                                | T1      | Specified |
| **STR-045** | Opening such a URL must navigate to the node and highlight it, subject to the recipient's permissions (**IAM**)     | T1      | Specified |
| **STR-046** | A deep link must survive the outline being reordered, because it must address identity rather than position         | T1      | Specified |
| **STR-047** | A deep link must be able to address a specific baseline, so that "section 4.2 as approved" is expressible (**VER**) | T3      | Specified |

## 10. Page breaks

Settles [CNT-Q07](CNT-content-and-authoring.md). The question was whether a forced page break is
content or structure, and the answer is that it is both, split along a line that already exists.

**"This section starts on a new page" is structure.** It is a property of a node's position in a
document, it differs between documents that share the component, and it belongs here.
**"Keep these two blocks together" is content**, because it is a property of the blocks themselves
and travels with them wherever they are used. That half is CNT's, through a block style.

| ID          | Requirement                                                                                  | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------- | ---------- | --------- |
| **STR-048** | An outline node must be able to declare that it begins on a new page, or on a new recto page | T1         | Specified |
| **STR-049** | That declaration must be a property of the node, never of the content the node references    | Constraint | Specified |
| **STR-050** | Page-break declarations must be ignored, without error, by output formats that have no pages | T1         | Specified |

## 11. Non-requirements

| ID          | Not this                                                                                                                                                                                                                                                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **STR-N01** | **No numbering stored in content.** A number is computed from an outline, a layout and a profile, and storing one makes all three unchangeable                                                                                                                                                                                                                                     |
| **STR-N02** | **Sections are not reusable.** A shared section is a component; that is what components are for                                                                                                                                                                                                                                                                                    |
| **STR-N03** | **No page geometry here.** Size, margins, running heads and columns belong to the publishing layout                                                                                                                                                                                                                                                                                |
| **STR-N04** | **No outline without a document.** A standalone tree of sections that no document owns is a template's starting outline, and belongs to **TPL**                                                                                                                                                                                                                                    |
| **STR-N05** | **No bookmarks on arbitrary content.** A cross-reference targets an outline node, a caption-bearing block, a footnote or a bibliography entry (STR-026) - things that carry identity for their own reasons (**CNT-081**, **CNT-125**). A bookmark anywhere would be an identity created solely to be pointed at, and it would have to survive every edit to the sentence around it |

## 12. Open questions

| ID          | Question                                                                                                                                                                          | What would settle it                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **STR-Q01** | **May a number ever be overridden by hand?** "Section 4a" appears in real submissions, usually because a numbered thing was inserted after a document was already cited elsewhere | A real regulatory submission that requires it. The default answer is no, because an override is a stored number by another name                     |
| **STR-Q02** | **Do cross-references need to cross documents?** A submission may reference a section of a companion report by number                                                             | Whether early customers submit related documents as a set. It would make resolution depend on a baseline of something else, which is a large change |
| **STR-Q03** | **Is an index in scope at all (STR-043)?** It needs marked entries in content, which is a CNT change                                                                              | A customer whose house style requires one. Marked as `should`, not `must`, until then                                                               |
| **STR-Q04** | **How is "above" or "below" resolved (STR-027)?** It depends on final pagination, which the editor cannot know                                                                    | The publishing engine decision, since only the paginator knows whether a target is above                                                            |

## 13. Traceability

| This document             | Rests on                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| STR-051                   | REU-028 to REU-030, PUB-002 - one order, stated once                                            |
| STR-052                   | VER-018, REU-040 - what a baseline pins, and what a publication records                         |
| STR-055                   | STR-027, STR-050 - the paged and unpaged forms                                                  |
| STR-057                   | REU-044 - the same cycle rule from the reuse side                                               |
| STR-051 to STR-057        | [The v1 review](<../../reviews/STR - Structure, numbering and cross-references.md>); section 14 |
| Section 3                 | Scope §6 (outline, section, component reference); CNT's governing constraint                    |
| STR-020, STR-030, STR-042 | Scope §7.3 conditional profiling; resolution order matters                                      |
| STR-023 to STR-025        | CNT-081, caption-bearing blocks carrying identity                                               |
| Section 10                | Settles CNT-Q07                                                                                 |
| STR-044 to STR-047        | Scope §7.2 deep links                                                                           |

## 14. Change history

One row per change, against
[the review](<../../reviews/STR - Structure, numbering and cross-references.md>) that prompted it.
The rules for what gets a new identifier are in [the index](README.md#how-a-requirement-is-written).

| Point                                     | Change                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The resolution order exists only in prose | **STR-051** makes it one constraint: numbering computed only over what survives conditions, cross-references resolved only over what has been numbered. It was stated twice as commentary and enforced in three places that each assumed it, so a future requirement could have assumed the opposite without contradicting anything                                                                 |
| Renumbering drift across baselines        | **STR-052**, and it is the failure this market notices: an edit between baseline 3 and baseline 4 moves the "section 4.2" a companion filing already cites on paper. A baseline's numbering must be reproducible from its pinned inputs - outline, layout version **and profile** - and a publication records the numbers it published. VER-018 pins the first two; REU-040 now records the profile |
| Identifier scope is unstated              | **STR-053**: unique within the tenant, not within the document. STR-Q02 may widen what a reference can point at; it cannot change what identity means                                                                                                                                                                                                                                               |
| "Ordered tree" has no root or minimum     | **STR-054**: an implicit root, which is the document and carries its deep link, and an empty outline that is valid rather than an error - it publishes its front matter (PUB-079)                                                                                                                                                                                                                   |
| Page-form references in unpaged formats   | **STR-055** closes the asymmetry with STR-050. A page break is decoration a format may drop; a page reference is a sentence pointing somewhere, so it renders a declared alternative or fails - never a number that means nothing                                                                                                                                                                   |
| Occurrence-local references               | **STR-056** states what STR-010 and STR-021 implied: an intra-component reference targets the nodes of its own occurrence                                                                                                                                                                                                                                                                           |
| The referenceable target set              | **Deliberate, and now recorded as STR-N05.** Targets carry identity for their own reasons (CNT-081, CNT-125); a bookmark on an arbitrary paragraph would be an identity created only to be pointed at, and would have to survive every edit around it                                                                                                                                               |
| Concurrency on outline edits              | **Delegated visibly**: a boundary row for **COL** and **API**, which own the lock (COL-005) and the version precondition (API-037) rather than a third answer here                                                                                                                                                                                                                                  |
| STR-038's "bindings", STR-011's phrasing  | STR-038 now cites **DAT** and **COL** for the state it surfaces. **STR-011 is superseded by STR-057**, which names the graph being walked - the component references reachable from the outline - rather than saying an outline must not contain itself                                                                                                                                             |

### Counts

|                  | Before | After                     |
| ---------------- | ------ | ------------------------- |
| Requirements     | 50     | 57, of which 1 superseded |
| Non-requirements | 4      | 5                         |
| Open questions   | 4      | 4                         |

### From the cross-cutting review

A later review read all twenty-one documents against each other. Its sections are answered in
[XXX - Response.md](<../../reviews/XXX - Response.md>); what changed here:

| Review sections | Change                                                                                                                                                                                                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1, 2.8, 3.2.9 | **STR-009 superseded by STR-058**, recording which of three reference modes a component reference takes. **STR-059** answers outline concurrency here rather than delegating it to a document that does not own document-level locking: a version precondition, conflict detection in the interface, and the component lock still doing its own job |
