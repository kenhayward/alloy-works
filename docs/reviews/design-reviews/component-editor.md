## Review of `component-editor.md` against the supplied requirement documents

I reviewed `component-editor.md` against the four requirement documents you provided:

- `CNT-content-and-authoring.md`
- `MET-metadata-and-component-types.md`
- `STY-styles-and-presentation-themes.md`
- `API-api-mcp-and-extensibility.md`

I treated this as a requirements/design review, not an implementation review. I have **not** assumed that the referenced-but-not-provided documents are settled: `COL`, `storage-and-versioning.md`, `realtime.md`, `themes.md`, `content-model.md`, ADRs, etc. Where the design depends on those, I flag it as an unresolved dependency rather than judging the detail.
Overall, the design has a strong core shape:

- lock claimed by first change;
- continuous saving as iterations;
- versions cut only by positive act;
- undo/history kept in session storage and replayed after reload;
- metadata values carried with content in iterations/versions;
- component type chosen at creation, fixed fields read-only;
- API enforces lock on mutating routes;
- native spellcheck decision is consistent with `CNT-147`/`CNT-148`.

However, as written it is **not yet a complete realisation of the requirements**. It leaves several T1 obligations unmet or underspecified, and it has important edge cases missing around paste/copy, identity, footnotes in tables, metadata definition drift, iteration sequencing, API idempotency/preconditions/pagination, standalone-component theme context, equation canonicalisation, accessibility focus/announcements, and verification/release gates.

Below are the gaps and issues I would raise before accepting this design as a review-ready draft.

---

# 1. Content surface and content model

## 1.1 Foreign paste is effectively unavailable in this slice — High / possible blocker if T1 coverage is expected

The design says:

> Until the pipeline is built, the editor accepts plain text only rather than admitting anything unsanitised.

But `CNT-060` to `CNT-064`, and `CNT-130`/`CNT-131`, are T1 requirements that require paste from Word, Markdown and HTML to preserve structure, sanitise hostile content, report what was normalised/dropped, and test both halves of the result.

As written, this slice does not meet those requirements unless:

1. the admission pipeline is part of this build, or
2. the draft explicitly records that foreign paste is intentionally deferred in this slice and the affected requirement status/tranche is updated accordingly.

If the intent is “first slice of the editor” but still T1-complete for component content, plain-text-only paste is a material gap. If it is deliberately partial, the document should say so clearly rather than implying that paste will simply work through `transformPasted` once another design arrives.

Recommended fix:

- state whether foreign paste is in scope for this slice;
- if yes, specify the pipeline stages and report shape;
- if no, add an explicit non-conformance/deferral note listing `CNT-060`–`CNT-064`, `CNT-130`, `CNT-131`;
- either way, keep the “plain text only” behaviour as a safe interim mode but do not present it as satisfying T1 paste requirements.

---

## 1.2 Internal copy/paste is only implied, not specified — High

The design says paste goes through an admission pipeline that includes re-identification and validation, and that the identity plugin handles split/join/re-identification. That is not enough for `CNT-132` to `CNT-135`.

Those requirements specifically cover copying within the product:

- every pasted block must receive a newly allocated identifier;
- annotations whose owning artifact does not travel must be dropped and named in the report;
- older schema versions must be migrated or refused, never stored unmigrated;
- internal copy must produce the same report standard as foreign paste.

The identity description in the design is framed around conflict resolution:

> a block at its identifier's forward-mapped position … keeps it; every other block holding that identifier is re-identified.

That does not clearly guarantee `CNT-132`, which says pasted content must be **re-identified**, not merely collision-resolved. If copied blocks have identifiers that do not already exist in the receiving component, a conflict-resolution rule could keep them, which would violate the requirement.

Recommended fix:

- add an explicit product-internal paste/copy command path;
- state that internal paste always re-identifies every pasted block and preserves/reassigns mark identifiers according to the rules for each annotation type;
- specify how cross-component annotations are dropped and reported (`CNT-133`);
- specify schema migration/refusal on entry (`CNT-134`);
- require a report naming re-identified and dropped items (`CNT-135`).

---

## 1.3 There is no complete authoring matrix for the closed content vocabulary — High / Medium

The surface table covers:

- paragraph styles;
- seven character marks;
- lists;
- tables;
- equations;
- footnotes;
- figures/images;
- cross-references/citations/variables/bindings as rendered atoms;
- symbol palette.

But the closed content model includes more, and some of these are not addressed:

### Hyperlinks

`CNT-126` to `CNT-128` require hyperlinks as a mark over text with an absolute target, scheme allowlist validation, and carrying into output formats. The design does not include hyperlink commands, keymap entries, or paste handling for links beyond the generic pipeline statement.

This is a T1 gap unless hyperlink authoring is explicitly deferred.

### Defined term

The design correctly says `CNT-035` is left unclaimed for **defined term** because that needs LIB terms and is T6. But `CNT-031` and `CNT-035` are written as T1 requirements requiring the author to apply/remove every mark in `CNT-031`. If defined term remains unavailable in this slice, that either:

- changes requirement timing, or
- requires an explicit exception such as “defined term is schema-supported but not commandable until LIB terms exist.”

As written, the design does not reconcile that cleanly.

### Condition marks / suggestion marks / comment anchors

`CNT-032`, `CNT-033`, and `CNT-034` are T1 requirements about supported mark types. The surrounding features may be COL/REU’s, but the component editor still needs to say how existing content carrying those marks is rendered in this slice:

- visible or invisible?
- read-only atom?
- unresolvable marker?
- colour-independent treatment if suggestions are present (`CNT-138`)?
- what happens when a suggestion/comment anchor from another artifact is encountered?

The schema may include them, but the surface design does not.

### Admonitions

Admonition styles are T2 in `STY`, and admonition support is T2 in `CNT-120`. That deferral may be acceptable, but because `CNT-116` requires the first stored schema to carry node/mark types that later tranches depend on, the design should explicitly state that unused-but-supported blocks/marks exist in the editor schema even if their commands are disabled until a later slice.

Recommended fix:

Add an authoring matrix table with rows for every block/node/mark in the content model and columns such as:

| Content item    | Can create? | Can edit?  | Rendered read-only? | Unresolvable behaviour?         | Requirement refs     |
| --------------- | ----------- | ---------- | ------------------- | ------------------------------- | -------------------- |
| Paragraph       | yes         | yes        | n/a                 | unresolvable style marker       | CNT-014, STY-...     |
| Hyperlink       | ?           | ?          | ?                   | refused on entry / paste report | CNT-126–128          |
| Suggestion mark | no?         | read-only? | yes/no              | colour-independent marker       | CNT-033, CNT-137/138 |

This would make the slice boundary explicit.

---

## 1.4 Cross-references, citations, variables and bindings are renderable but not insertable — High if T1 authoring is expected

The design says:

> Cross-references, citations, variables, bindings | Rendered as atoms naming what they point at. Inserting each waits for the design that owns its target - STR, LIB, REU, DAT

That may be a reasonable architectural deferral, but `CNT-027`, `CNT-028`, `CNT-029`, and `CNT-030` are T1 requirements that those inline nodes must be supported. “Supported” in an authoring area normally includes the ability to insert them, at least once their target systems exist.

If this slice cannot insert cross-references/citations/variables/bindings, then it is not fully meeting those CNT requirements as written. The draft should either:

1. provide minimal insertion commands against existing targets, or
2. explicitly record that these are schema-supported but command-unavailable in this slice, with the requirement impact noted.

The same applies to citations especially: `CNT-051` says bibliography entries must be managed artifacts within a space, referenceable from any component. If an author cannot create a citation in the component editor and bibliography management is elsewhere, that cross-slice path needs to be stated.

---

## 1.5 Figures and images cannot be created — High if T1 coverage is expected

The design says:

> Figures and images | Rendered from their asset. **Inserting one waits for the assets design**: nothing yet ingests an asset to insert

This defers insertion, but `CNT-017` requires figures supported with caption and alternative text referencing a managed asset; `CNT-022` makes figure alternative text required at publish; `CNT-086` and `CNT-087` require images in table cells and inline.

If the component editor is supposed to be an end-to-end editing surface for one component, then not being able to create a new figure or image is a significant capability gap unless explicitly phased out of this slice.

The design also does not say how existing figures/images behave when:

- the asset is unresolved;
- intrinsic dimensions are unknown;
- alternative text is missing;
- caption needs editing;
- image style cannot be resolved in editor per `CNT-122`/`STY-035`.

Recommended fix:

Even if insertion is deferred, specify the interim read-only/editable behaviour for existing figure/image nodes:

- render unresolved asset as an explicit unresolvable marker (`STY-070`);
- allow caption and alttext editing where possible;
- validate missing required alttext visually while authoring;
- resolve image style by `STY` rules or mark it unresolved.

If figure/image authoring is not in this slice, record that explicitly against the CNT requirements.

---

## 1.6 Footnotes are under-specified for the market — High

The design says:

> Footnotes | A node view holding a nested editor for the note's paragraphs, as in ProseMirror's footnote pattern

That is too thin for `CNT-036` to `CNT-042`, and especially for `CNT-107`.

Requirements that need explicit design coverage:

### Anchoring contexts

- `CNT-036`: anchor to a span of text;
- `CNT-037`: anchor to a cell of an authored table;
- `CNT-038`: anchor to a table as a whole.

A standard ProseMirror footnote plugin often covers text anchors only. Table-cell and whole-table anchors are market-specific here and need explicit node/attribute design, commands, and accessibility behaviour.

### Key columns / weaker positional fallback

`CNT-107` requires an authored table to be able to declare a key column or set of columns. Where declared, footnotes anchor by key value; where not declared, they fall back to row/column position and must be marked as the weaker form because they do not survive reorder.

The design does not say:

- how an author declares key columns on an authored table;
- how footnote anchors update when rows are reordered or cells merged/split;
- how the editor displays the difference between strong key-based anchors and weak positional anchors;
- what happens if a referenced key value no longer exists.

### Restricted footnote content

`CNT-129` closes the list of allowed footnote content: paragraphs, character marks from `CNT-031`, citations, inline equations, cross-references, hyperlinks, variables, inline data bindings. It must **not** include tables or images.

“A nested editor for the note’s paragraphs” does not by itself guarantee that restriction. The design should state that footnote content uses a restricted schema and command set.

Recommended fix:

Add a short footnote subsection covering:

- anchor target model;
- table key column UI/attribute;
- positional fallback marker;
- restricted nested editor schema;
- commands for inserting/moving/deleting footnotes in all three anchor contexts;
- tests for reorder, merge/split, unresolved anchor failure at publish (`CNT-042`).

---

## 1.7 Empty paragraph and minimum-block invariants are missing — High / Medium

ProseMirror needs to be able to generate an empty paragraph. The design already acknowledges that a block’s `id` has a default of `null` because ProseMirror must generate a paragraph. But the requirements have two competing constraints:

- `CNT-124`: every component always holds at least one block; newly created component holds exactly one empty paragraph.
- `CNT-023`: empty blocks used for vertical spacing must not be representable.

The design does not define how these coexist.

Specifically, it needs to say:

- can the author create multiple consecutive empty paragraphs?
- if they delete all text from a paragraph between two other paragraphs, is that allowed or normalised away?
- what happens when backspacing in a single-paragraph component — must the last block be preserved/reinserted?
- what does paste normalisation do with runs of empty paragraphs?
- are transient empty paragraphs part of stored iterations, or only editor-cursor placeholders?

This is not just an implementation detail. It affects validation, comparison, publish behaviour, and the content hash.

Recommended fix:

Add a concrete rule such as:

- the schema permits an empty paragraph only where structurally necessary;
- on paste/normalisation, superfluous consecutive empty paragraphs are collapsed or removed and reported;
- delete/backspace commands must never leave the document with zero blocks; if the author deletes all content, one empty paragraph is restored automatically as part of command normalisation;
- iterations stored to service must satisfy the same invariant.

Add tests for:

- new component = one empty paragraph;
- paste containing blank lines;
- deleting all text;
- backspace at start/end;
- split/join leaving no empty spacing blocks.

---

## 1.8 Block and mark identifier allocation is not fully specified — High / Medium

The design references ADR-0023’s identity plugin and says `fromEditor` refuses a `null` identifier. That is good, but it does not fully specify the lifecycle of identifiers required by `CNT-002`, `CNT-004`, and `CNT-132`.

Missing details:

### Block IDs

- Who allocates an ID for a newly created block in the editor? Client-generated UUID? Server-assigned on next iteration?
- How is uniqueness within the component guaranteed across restored iterations, copy/paste, and two windows of the same author moving the lock?
- What happens if locally generated IDs collide after reload or restore?

### Mark / annotation IDs

`CNT-004` requires every mark to carry an identifier and that a fragmented annotation remains one annotation under one identifier. The design focuses on block identity, but mark identity is equally load-bearing for overlapping suggestions/comments/conditions.

The design should state:

- how mark IDs are preserved across split/join;
- how copied marks are re-assigned or retained according to the rules in `CNT-132`–`CNT-135`;
- what happens when an annotation is fragmented across nodes and then copied into another component.

### Condition axes on copy/paste

`CNT-Q14` remains open: what happens when content carrying a condition arrives in a space whose axis does not exist. The design does not address this at all, even as “not decided yet.” Since internal paste is part of this surface, the draft should explicitly name that dependency.

Recommended fix:

Add an identity subsection or table specifying allocation/re-identification rules for blocks and marks by operation:

| Operation           | Block IDs                                       | Mark/annotation IDs                         | Notes                         |
| ------------------- | ----------------------------------------------- | ------------------------------------------- | ----------------------------- |
| New block in editor | ?                                               | n/a                                         | e.g. local UUID, never reused |
| Split/join          | preserved where ADR says so                     | fragmented annotation stays one ID          |                               |
| Internal paste      | all pasted blocks re-identified                 | cross-artifact annotations dropped/reported | CNT-132–135                   |
| External paste      | new IDs allocated                               | sanitised/migrated/refused                  | CNT-130, CNT-134              |
| Restore iteration   | migrated/validated to current schema or refused | same                                        | recovery safety               |

---

## 1.9 Caption identity for numbered blocks is not specified — Medium / High

`CNT-081` requires every caption-bearing block — figure, table, block equation — to carry a stable identity so the outline can number it and cross-references can target it.

The design mentions table accessibility via `toDOM`, including `<caption>`, but does not specify that captions are editable content nodes with stable identities in the ProseMirror schema.

Missing points:

- Are table captions part of the stored content model, or just rendered DOM?
- How is a caption edited?
- Does an equation block support a caption and what is its identity?
- Figure captions are deferred with assets, but existing figures still need identity/editing rules if they can be rendered.
- What happens to caption identity on paste/copy/split/join?

This matters because numbering and cross-references later depend on it. If captions are not first-class content nodes, the document view/publisher will have no stable target to number or reference.

Recommended fix:

State explicitly how each caption-bearing block stores its caption:

| Block          | Caption representation              | Identity rule                                         | Editing UI |
| -------------- | ----------------------------------- | ----------------------------------------------------- | ---------- |
| Authored table | node/attribute in content model     | stable ID preserved through split/join/copy per rules | ?          |
| Figure         | asset reference + caption + alttext | block/caption IDs                                     | ?          |
| Block equation | equation node + optional caption    | stable IDs                                            | ?          |

Add tests that captions survive copy/paste and re-identification correctly.

---

## 1.10 Equations: canonical representation, placement, alttext and engine risk — High / Medium

Equations are a strong part of the design because it chooses native MathML in Chromium/Electron. But there are several requirement-level gaps.

### Canonical stored representation

`CNT-043` requires one canonical stored representation independent of how equations were entered.

The design says:

> editing opens a LaTeX field converted to MathML as you type, with the LaTeX kept (CNT-043)

That creates ambiguity. If both MathML and LaTeX are stored, there is a risk of two sources of truth. The design should state clearly:

- what is canonical — presumably normalised MathML;
- whether LaTeX is persisted at all;
- if persisted, that it is non-canonical and excluded from rendering/comparison/digest where appropriate;
- how equivalence is determined between different entry paths.

MathML also needs deterministic normalisation. Attribute order, namespace declarations, whitespace, and converter versions can produce syntactically different but semantically identical MathML. That would affect comparison and version digests unless canonicalised.

Recommended fix:

Add an equation subsection stating:

- canonical payload is normalised MathML;
- converter output is pinned to a known version or passed through a canonicalisation step;
- any LaTeX field content is either transient editor state or explicitly non-canonical metadata;
- tests assert that semantically equivalent equations entered by different paths produce the same stored canonical form, or at least that rendering/comparison behaviour remains deterministic.

### Placement contexts

`CNT-046` requires equations to be available in every context: running text, heading, table cell, footnote and caption.

The component editor has no headings because `CNT-N09` says components do not carry headings; headings belong to the outline/document view. That part is fine if explicitly bounded. But for this slice it should still state which of the other contexts are supported:

- inline equations in paragraphs;
- block equations at top level;
- equations inside table cells;
- equations inside footnote content;
- equations in captions, where applicable.

The design does not give an explicit placement matrix.

### Alternative text generation

`CNT-048` requires accessible textual alternative, generated where possible and author-editable. The design says it is generated when the equation is entered. That may leave gaps for:

- pasted equations;
- migrated equations;
- restored iterations containing equations;
- imported content.

The editor should either generate missing alttext lazily on load/validation or explicitly mark it as missing/required before publish. The design does not say what happens if the speech rule engine is unavailable, fails, or produces an empty result.

### Speech rule engine risk

The open question about the speech rule engine’s size and licence is important because `CNT-048` is T1. If the engine cannot be loaded for licensing/size reasons, the design needs a fallback decision:

- fail loud when generation is unavailable;
- allow manual authoring of alttext;
- mark equations with missing generated alternatives as publish blockers where required.

This should not remain only an open question if it affects T1 conformance.

---

# 2. Session state machine, locking, saving and recovery

## 2.1 Claim refusal and pending-change behaviour are under-specified — High

The design says the first change is held while the lock is claimed:

> The first change is held - the surface shows that editing is starting - and applied when the lock is granted.

That satisfies the spirit of `COL-005`, but several edge cases are missing.

### If the claim is refused

The state table says:

> Refused → Reading, naming the holder

But it does not say what happens to the held change.

Possible behaviours include:

1. apply it locally anyway and keep it for later — probably wrong if another identity holds the lock;
2. discard it silently — bad UX and possibly violates recoverability expectations;
3. retain it in a local “unclaimed” state with explicit UI — better, but needs specification;
4. reject the transaction before local mutation and show an explanatory status.

This matters because `CNT-067` requires recovery to the last edit the author saw accepted, and authors will expect their keystroke/paste not to vanish silently if claiming fails.

### What happens during Claiming?

If the first change takes more than a round trip, can the user keep typing? If yes:

- are subsequent changes queued?
- are they applied on grant in order?
- is there a maximum queue size?
- what if a paste or command produces many transactions while claiming?

The design should define a pending-change buffer and its failure rules.

Recommended fix:

Add explicit transitions for Claiming:

| Event                           | Behaviour                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Grant received                  | apply held change(s) in order; enter Editing                                                         |
| Refusal                         | show holder/expected release; keep or discard held change according to stated policy; no silent loss |
| Additional input while claiming | queued, rejected with warning, or applied on grant — choose one and test it                          |
| Claim timeout/error             | return to Reading or Recovery with structured error and retry affordance                             |

Also state whether metadata field changes can be the “first change” that triggers claiming. I assume they should, because values are part of the iteration.

---

## 2.2 Metadata edits are not fully integrated into session/save/recovery rules — High / Medium

The design says:

> Undo covers content, not metadata.

That is a reasonable implementation decision given ProseMirror history, but it creates several requirements-level questions that need to be answered explicitly.

### Does editing metadata claim the lock?

The shape paragraph says “the first change an author makes claims the component’s lock.” The session table then describes Reading/Claiming mainly in terms of surface changes. It should say plainly:

- typing into a metadata input is a change;
- it enters Claiming if not already Editing;
- while Claiming, metadata edits are held or queued using the same rules as content edits.

### Do metadata edits trigger autosave?

The saving paragraph says after a pause in changes the renderer sends an iteration with “the whole content and values.” That implies yes, but it should be explicit that metadata input changes start/reset the two-second idle timer and participate in continuous-save cadence.

### Are metadata values restored on reload/recovery?

Session storage is described as holding:

> the version the session opened from, the document at that point, and every step since

That sounds content-step-oriented. But iterations include metadata values. If an author changes a metadata field, then reloads before autosave fires, what happens?

The design should specify whether session storage holds:

- only ProseMirror steps;
- or also current/latest metadata value snapshots per sequence;
- and how reload restores the latest acknowledged iteration’s metadata plus any unsent local metadata state.

### Does Recovery restore content only or content + values?

`CNT-090` says restoring an iteration makes it the current content of the session as an edit, undoable. But iterations are snapshots of content **and** metadata values. If restoration restores only ProseMirror content, that could produce a draft where content and metadata have diverged from any actual stored iteration.

I would require: restoring an iteration applies the full snapshot — content plus metadata values — as a new undoable step in the session.

---

## 2.3 Lock visibility for a standalone component is unresolved — High / Major dependency

The design says lock changes notify through `realtime.md`’s row-and-notify path, but then openly asks:

> Where a component opened outside any document hears about its lock… either the stream gains a component scope or others see the lock only once the document view exists.

This is not just an implementation detail. Several requirements depend on timely lock visibility:

- `CNT-074` requires showing why editing is unavailable, including who holds the lock and when release is expected;
- `COL-005`/`API-039` require refusal to name holder and expected release;
- `realtime.md`/`API-036` likely require changes to reach entitled viewers within a stated interval.

If this slice allows editing a component on its own, it needs at least one of:

1. a component-scoped realtime stream/event channel;
2. polling with a stated maximum staleness and explicit requirement impact; or
3. an explicit deferral saying standalone lock visibility is not available until the document view exists.

The design should also state what `GET /v1/components/{id}` returns about current lock state. Currently it says:

> The latest version, its values, and the effective fields for authoring

It does not say whether the response includes:

- current holder principal/session;
- expected release time;
- lock token or session id needed to continue/move.

If a second window of the same author is to be told “held by your other session,” it needs that information before making a mutating request, otherwise the UX becomes “try to type and discover failure.”

Recommended fix:

Decide one of the following and record it:

- Add component-scoped realtime subscription for lock changes.
- Or add explicit polling with interval and error handling.
- Or explicitly state that this slice only shows lock state after a refusal, and that `CNT-074`/equivalent visibility is deferred to document view.

Also amend the API section:

```text
GET /v1/components/{id}
returns:
  latest version content/values
  effective fields
  structural attributes incl base direction/type/title/language
  definition versions used for authoring
  lock state: holder, expected release, session id if same principal, etc.
```

---

## 2.4 Same-author second-window behaviour can strand unsaved work — High / Medium

The design says a second window of the same author may **continue here**, moving the lock to the new session. That is good for `CNT-071` and VER visibility rules, but it does not handle the case where the old window still has unsent local steps in sessionStorage.

Scenario:

1. Window A is editing component X; lock held by session A.
2. Some changes are acked; newer changes remain only in sessionStorage.
3. Author opens Window B and clicks “continue here.”
4. Lock moves to session B.
5. Window A now cannot save its local unsent steps because it no longer holds the lock.

Those unsent steps may be lost unless there is an explicit handoff rule.

Recommended fix:

Specify what happens when a same-author session moves the lock away from another session that has unsaved local state:

- require flushing/acknowledging pending iterations first, if possible;
- or explicitly offer “discard local changes” versus “keep local recovery copy”;
- ensure acked iterations remain visible/recoverable to the same principal within the retention rules;
- define how Window A enters Recovery and whether it can move the lock back again.

Also specify how the old window learns that the lock moved: realtime event, polling, or next API refusal.

---

## 2.5 Iteration sequence handling is missing an important concurrency rule — High

The design says PUT iterations are idempotent on session and sequence:

> The service inserts it unless that session and sequence are already stored, so a retry never makes two rows.

That handles duplicate retries for the same sequence, but not out-of-order sequences after failures or delayed packets.

Example:

1. Client sends seq 5; response is lost.
2. User keeps editing.
3. Client sends seq 6 and receives acknowledgement.
4. The delayed seq 5 arrives later.

If the server simply inserts “unless already stored,” it may accept an older whole-snapshot iteration after a newer one, causing the draft to regress. Since iterations are full snapshots, this is especially dangerous.

The design needs a monotonicity rule:

- for a given session, accepted sequence numbers must increase;
- a PUT with `seq <= latestAcceptedSeq` should be rejected or ignored as stale with a stable machine-readable code;
- exact retries of the same seq/payload should be idempotent and return the original result;
- if the same seq is resent with different content/hash, that is a conflict and should not silently ignore the newer state.

Recommended fix:

Add to the API section:

```text
PUT /iterations/{session}/{seq}
  - 201/200 accepted
  - duplicate exact retry returns original acknowledgement
  - seq < latestAcceptedSeq -> iteration.stale_sequence (or ignored with code)
  - same seq but different payload hash -> iteration.conflict
```

Also specify how the client reconciles after reload:

- query server for the session’s latest acknowledged sequence;
- compare with local sessionStorage state;
- adopt server state as baseline if it is ahead;
- replay only missing steps;
- never allow local state to overwrite a later acknowledged iteration without user-visible recovery.

---

## 2.6 Recovery visibility, retention and restore semantics need clarification — Medium / High

The design says:

> A **Recovery** panel lists the component's retained iterations to its lock holder...

But Recovery is entered when:

> The lock expired or was taken while changes existed

At that point the session may no longer be “the lock holder.” So there is ambiguity.

Questions to answer:

### Who can list retained iterations after losing the lock?

Possible interpretations:

1. only the current lock holder’s principal;
2. only the exact current editing session;
3. a former holder in Recovery if they are still entitled to reclaim and no other identity now holds it;
4. same principal always, while retention window applies.

`CNT-089` says iterations visible only to the editor holding the lock. The design later says iterations remain visible to the author because the holder is the principal (`VER-002`). Those need to be reconciled in the API route specification.

### What does restore include?

As noted above, restore should include metadata values as well as content.

### Are restored iterations migrated/validated?

If a retained iteration was saved against an older schema version, restoring it into today’s editor must either migrate it or refuse with a named error (`CNT-012`, `CNT-013`). The design does not say this for the recovery path.

### Retention window

`CNT-089` says iterations are retained until next version cut and for a declared window after that; VER owns the window. The component editor should at least state:

- where the retention window comes from;
- whether `GET /iterations` returns only in-window rows;
- what happens when an iteration expires while displayed;
- how the UI refreshes/expired entries are removed.

Recommended fix:

Clarify authorization and restore payload:

```text
GET /v1/components/{id}/iterations
  - available to current lock holder principal/session as defined by VER rules
  - for Recovery, accessible only if user is still entitled to reclaim and no other identity currently holds the lock
  - returns full snapshots incl content + metadata values
  - restored snapshot is migrated/validated before entering editor
```

Also state retention window source and UI expiry behaviour.

---

## 2.7 Failure transitions for Cutting/Releasing are missing — Medium / High

The session table has happy-path exits:

- Cutting → Cut, or nothing to cut → Editing;
- Releasing → Reading.

But it does not cover failure cases such as:

1. unsent changes fail to flush before version request;
2. version request is refused due precondition mismatch (should be rare while lock held but possible after same-author move);
3. version digest unchanged and user expected a cut;
4. network fails during Done editing after some iterations acked but not all local steps flushed;
5. service refuses due fixed metadata value changed unexpectedly by definition drift.

For **Done editing**, releasing the lock before flush failure is handled could strand unsaved work. The design should specify:

- Cutting waits for flush acknowledgement unless user explicitly chooses otherwise;
- if flush fails, remain in Editing/Recovery with retry affordance and clear indicator state;
- Done editing must not silently release after an unflushed local draft unless the author is told and confirms discard/recover-later.

Recommended fix:

Add failure columns to the session table:

| State     | Failure                         | Behaviour                                                                                |
| --------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| Cutting   | flush fails                     | remain Editing/Recovery; retry/backoff; no version request                               |
| Cutting   | version refused by precondition | show structured error with current version; do not release if user intended Done editing |
| Releasing | final flush fails               | keep lock or enter Recovery with explicit recovery path                                  |
| Releasing | lock already moved              | reconcile local state, offer restore/discard                                             |

---

## 2.8 “Clearing history” on cut should explicitly include stored steps — Low / Medium

`CNT-103` says cutting a version clears the history **and** the stored steps so undo never reaches past a version. The design’s state table says:

> Cut, or nothing to cut → Editing, history cleared

It does not explicitly say sessionStorage steps are deleted/reset after a successful cut.

This is probably intended, but it should be stated because session storage is the mechanism that makes reload undo possible. If old steps remain, a later reload could accidentally replay pre-version steps and violate `CNT-103`.

Recommended fix:

Add explicit text:

> After a successful Save version or Done editing cut, the editor clears its ProseMirror history and deletes/replaces the session storage entries for that component/session so undo cannot reach past the new base version.

Also define what happens if deletion fails locally: next load should detect version mismatch and discard pre-version steps.

---

# 3. Metadata panel and component type/metadata rules

## 3.1 Multi-value fields are missing — High / possible blocker for metadata completeness

`MET-002` says a field must declare whether it holds one value or several. `MET-030` says multi-value fields:

- hold no value twice;
- keep values in the order given;
- may declare maximum count;
- required means at least one value;
- default is a list of values.

The design’s metadata panel lists input types:

> text, a decimal input that keeps the string entered, date, time, date and time with a zone, a switch, and a user picker over the tenant's principals.

There is no ordered multi-value input. That is a significant omission if any tenant field holds multiple values.

Recommended fix:

Add an explicit multi-value editor behaviour:

- ordered list of values;
- add/remove/reorder controls;
- duplicate validation;
- maximum count validation;
- required = at least one value;
- default applied as list when creating component/version;
- order preserved in iteration payload, version digest and storage.

This should be part of the metadata panel design now, not deferred until first tenant need.

---

## 3.2 User fields after de-provisioning are under-specified — Medium

`MET-029` requires a user field’s value to remain readable, shown as no longer active, after that user is de-provisioned, and must never become empty because the user left.

The design says the metadata panel has “a user picker over the tenant's principals.” That does not say:

- whether inactive/deprovisioned users appear in the picker;
- how a stored value for a departed principal is displayed;
- whether the field remains valid if its only user is de-provisioned;
- what label/state is shown (“no longer active”);
- what API data is needed to render that state.

Recommended fix:

State explicitly:

- picker offers selectable current/active principals as required by IAM rules;
- stored values for inactive principals are rendered with a stable “no longer active” treatment;
- de-provisioning never clears the field value client-side or server-side;
- validation treats the value as present but flagged, unless a later rule says otherwise.

Add tests where a principal is deactivated after being saved in an iteration/version.

---

## 3.3 Date/time and UTC offset handling needs precision — Medium

`MET-028` requires:

- date-and-time values carry their offset from UTC;
- dates and times must carry no offset.

The design says the metadata panel offers “date and time with a zone.” That is close, but ambiguous.

A named IANA time zone is not the same thing as carrying an instant’s UTC offset. The stored value should name one instant unambiguously. If the UI lets authors pick a local date/time plus a time zone, the stored representation must still include the numeric UTC offset for that chosen instant.

Recommended fix:

Specify the stored shapes explicitly:

| Type      | Stored form                                                                     | UI behaviour                                                                          |
| --------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| date      | `YYYY-MM-DD`, no offset                                                         | date picker only                                                                      |
| time      | `HH:mm:ss` or as field validation defines, no offset                            | time input only                                                                       |
| date-time | ISO 8601 instant with explicit UTC offset/`Z`, e.g. `2025-01-01T12:00:00+01:00` | author may pick local date/time plus zone; service stores instant with numeric offset |

Add validation and round-trip tests for DST transitions if named zones are supported in the UI.

---

## 3.4 Validation error shape must be explicit — Medium

The design says validation runs on every change using the same `validate` the service and publisher use, and required/fixed fields name the schema. That is good. But `MET-022` requires a validation failure to name:

- field;
- rule;
- artifact;
- schema that applied the rule.

The design should state that all renderer-side metadata validation failures use a structured error object with those properties and stable machine-readable codes, consistent with `API-005`, `API-006` and `STY-061`.

Recommended fix:

Define the client-side validation result shape:

```json
{
  "code": "metadata.required_missing",
  "message": "...",
  "fieldId": "...",
  "rule": "required",
  "artifact": "component:<id>",
  "schemas": ["..."],
  "value": "..."
}
```

Also specify that service refusals use the same field/rule/schema naming, not merely a free-text message.

---

## 3.5 Definition changes during an active session are unhandled — High / Major gap

This is one of the most important metadata gaps.

The design says cutting a version loads the current definitions:

> loads the current definitions (`definitionsFor`, metadata.md); carries the values forward...

But what happens if a field, schema or component type changes while an author has the lock and is mid-edit?

Metadata requirements imply several things:

- `MET-017`: every version records the definitions it was written against and is validated by those for as long as it exists;
- `MET-018`: next version is written against current versions of type/schemas/fields;
- `MET-035`: assignments always take latest schema version, but new schema versions that would conflict are refused;
- `MET-036`: values whose fields no longer apply are not carried forward and must be recorded by field.

The design only says:

> If the current definitions no longer include a field that holds a value, the author is told which values the version will leave behind...

That covers the cut moment if the UI knows to check. It does not cover an active editing session where definitions have changed since the component was opened.

Example scenarios:

### New required field appears

1. Author opens component with schema v3.
2. Admin publishes schema v4 adding a required field.
3. Author continues typing for 20 minutes.
4. Metadata panel still shows old fields unless refreshed.
5. Save version uses current definitions and now asks for a value the author never saw.

### Field becomes fixed with new default

1. Open component has optional/free field `classification`.
2. Schema update makes it fixed to `regulated` from default.
3. Author’s draft still contains old value.
4. Iteration PUT may be refused because fixed value differs from default.

That is a surprising mid-edit refusal unless the UI has already told the author that the definition changed and adjusted the field.

### Field removed or no longer applies

1. Draft contains value for field `legacy_code`.
2. Schema update removes it.
3. Iteration payload still includes orphan value.
4. Service may reject unknown/orphan values, or store them ambiguously.

The design needs explicit rules:

- GET effective fields must include definition versions;
- client detects drift between session-open definitions and current authoring definitions;
- UI refreshes metadata panel and warns about new required/fixed/removed fields;
- iterations during a drifted session should have defined validation behaviour — preferably not silently refuse normal saves unless the value is unstoreable under current rules;
- Save/Done editing must show all values that will not be carried, per `MET-036`, before confirming.

Recommended fix:

Add a subsection “Definition version drift during an editing session” with state/API behaviour:

```text
GET /components/{id}
  returns definitionVersions for component type, schemas and fields used for authoring.

If current authoring definitions differ from the definitions the session opened from:
  - refresh metadata panel;
  - mark newly required fields;
  - replace fixed fields with their current schema default and explain why they are read-only;
  - show values that will be dropped on next version cut, by field;
  - do not silently lose user-entered values.

Iteration validation:
  - reject only what cannot be stored honestly under current definitions (MET-033/type rules);
  - save and display required/pattern failures (MET-021/023);
  - at version cut, apply carryForward + MET-036 leave-behind reporting.
```

Add tests for:

- schema adds required field while session open;
- schema changes fixed default;
- schema removes optional field with existing value;
- component type change in T2 would require separate audited act and next-version effect, not iteration-level silent mutation.

---

## 3.6 Component title and base language editing after creation are missing — High / Medium

The design says creating a component requires:

> A title, a base language (a BCP 47 picker), and a component type...

But it does not say whether or how the author edits title or base language after creation.

These are structural/versioned content attributes under `CNT-143`/`CNT-145`, not ordinary metadata fields. They belong to the version and affect:

- search/listing;
- publish behaviour;
- language marking of runs (`CNT-083` superseded by `CNT-140`);
- spellcheck rule for non-base-language runs (`CNT-147`).

The design should state:

- where title is edited in the UI;
- whether base language can be changed after creation;
- if it can, what happens to existing runs that had no explicit language tag because they matched the old base language;
- how spellcheck false rules are recomputed when base language changes;
- how title/base language changes participate in iteration/version digests.

Also, component type must remain read-only until `MET-014`’s T2 explicit audited act exists. The design says it is read-only in T1, which is good, but the API should also explicitly refuse client-submitted type changes in iterations/versions until that mechanism exists.

Recommended fix:

Add a component-header/subsection:

```text
Component structural fields:
  title: editable as part of content snapshot; change triggers save cadence and version cut when positive act occurs.
  base_language: BCP 47 picker; if editable, re-evaluate language mark coverage and spellcheck false for runs whose language differs from the new base.
  component_type: read-only in T1; service refuses mutation outside explicit audited type-change operation (MET-014).
```

Add API validation tests that an iteration/version payload cannot silently change `component_type` before T2.

---

# 4. API contract gaps

The API section is a good start, but it currently describes routes at a level that would not satisfy several API-area requirements without additional detail.

## 4.1 Idempotency keys are missing for component creation and version cutting — High / Major

`API-008` requires mutating requests to be idempotent when given an idempotency key, so retry cannot create a second document.

The design explicitly makes `PUT /iterations/{session}/{seq}` idempotent by session/sequence. That is good for autosave retries. But it does not mention idempotency keys for:

- `POST /v1/spaces/{space}/components`
- `POST /v1/components/{id}/versions`

Creation retry risk is obvious: if the client times out after the server creates component/version 0.1, a blind retry could create a second component.

Version cutting is safer because an unchanged digest returns `version.unchanged`, but it still needs defined retry semantics, especially when combined with optional note and opened-from version.

Recommended fix:

- require/support `Idempotency-Key` for component creation;
- support idempotency or equivalent safe-retry semantics for version cutting;
- define what a retried create returns after success (original component/version ids);
- define what a retried version cut returns if first attempt succeeded (version id) or no change (`version.unchanged`).

---

## 4.2 Version preconditions are not explicit on all mutating routes — High / Major

`API-037` says a mutating request against a versioned resource must carry a precondition naming the version it was read at, and `API-038` says there must be no unconditional overwrite.

The design’s Not-owned table says:

> API-037 | The version precondition is honoured below...

But the route list only explicitly states an opened-from/latest version check for `POST /versions`.

Missing or unclear:

### Iterations

`PUT /iterations/{session}/{seq}` modifies component draft state and should probably carry a precondition such as:

- `opened_from_version_id`, or
- `if_match_latest_version_id`.

Even while the lock is held, this prevents surprising behaviour if the same principal moves sessions, if there is a bug, or if an external admin action changes structural metadata.

### DELETE lock / Done editing

`DELETE /lock` may cut a version “if anything changed.” If it creates a version, that mutating effect should have a precondition as well.

Recommended fix:

Amend the API table to show required/expected fields/headers for each route:

| Route                  | Version precondition?                 | Idempotency?                                        | Notes                                                           |
| ---------------------- | ------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------- |
| POST components        | n/a new resource                      | Idempotency-Key required/recommended                | creation transactional                                          |
| PUT iterations         | yes: opened-from or latest version id | natural session/seq + optional key                  | reject missing/stale precondition per API-037/038               |
| DELETE lock if cutting | yes when it may cut a version         | safe repeat release semantics                       | return whether version was cut                                  |
| POST versions          | yes: opened-from/latest stated        | optional Idempotency-Key or defined retry semantics | `version.unchanged` is not an author error but still structured |

Also state that requests missing required preconditions are refused with distinct machine-readable code naming the current version, per `API-037`.

---

## 4.3 `GET /iterations` needs pagination/cap and stable order — Medium / High

The design says:

> GET `/v1/components/{id}/iterations` | Retained iterations, to the lock holder only

But `API-007` requires listing endpoints to page consistently with a stable order and opaque cursor. `API-058` extends that to anything listable whose size grows.

A long editing session can produce many retained iterations before a version is cut. Even if retention window bounds it, the design should not leave this as an unbounded implicit list.

Recommended fix:

Specify one of:

1. paged listing with opaque cursor and stable order by `(created_at, sequence/id)`; or
2. explicit cap (for example last N within retention window) and UI shows itself as capped, per `API-058`.

Also specify:

- default page size;
- maximum page size;
- ordering direction for recovery UI (probably newest first);
- how expired iterations disappear from pages during iteration.

---

## 4.4 Request identifier/correlation identifier are not stated — Medium / High

`API-047` requires every response to carry a request identifier, echoing the caller’s where one was given, appearing in logs and errors. `API-056` extends correlation identifiers across requests, events, realtime messages, notifications, etc.

The design says structured error contract is used for lock refusal, but does not state that every response/error includes:

- `request_id`;
- echoed caller request id where provided;
- server-generated correlation id if needed;
- same identifier in logs and diagnostics.

For autosave retries, rate limiting, and recovery support conversations, this is essential.

Recommended fix:

Add a short API contract paragraph:

> Every response from these routes includes `request_id`. If the caller supplies an id via header or body field, it is echoed. The same identifier appears in server logs and structured errors. Realtime lock notifications carry correlation identifiers per API-056 where applicable.

Add test assertions for this on each route.

---

## 4.5 Rate limiting / retry-after behaviour should be addressed — Medium

`API-051` requires rate limits to be declared in the specification itself and limited responses to say when to retry. The design has an open question about save cadence being unmeasured against service write budget.

Even if the final numbers are T2, this slice’s autosave behaviour should not assume unlimited retries at 30-second backoff without considering rate-limited responses.

The design says:

> not saved, retrying once a save has failed for ten seconds - with backoff to thirty seconds between attempts

If the service returns a declared rate-limit response with `Retry-After`, the client should honour that rather than using only its own fixed backoff.

Recommended fix:

Add API/session text:

- if an iteration request receives a limited response, use the server-declared retry interval where present;
- otherwise fall back to client backoff;
- save indicator remains “not saved, retrying”;
- declare rate limits in OpenAPI when this surface reaches that tranche.

Also add load/performance tests for autosave under rate-limit conditions.

---

## 4.6 IAM/authorisation route model is missing — Medium / High

The design assumes the user is an author and talks about lock holder, but it does not state the permission checks required by `API-053` or IAM generally.

At minimum, specify:

| Route                       | Required permission/role-ish behaviour                                                 | 401 vs 403 handling                                                |
| --------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| GET component               | entitled to read component/space                                                       | unauthenticated vs forbidden per IAM contract                      |
| POST lock / claim/move      | authoring/edit permission on component; same-principal move allowed where rules permit | naming holder/release for lock refusal separate from authz refusal |
| PUT iterations              | current lock holder only; author permission as well?                                   | structured error                                                   |
| GET iterations              | lock-holder/principal visibility per VER/CNT rules                                     | forbidden with holder info if not entitled                         |
| POST versions / DELETE lock | current lock holder and version-cut permission where applicable                        | structured refusal                                                 |

Lock denial (`API-039`) is a different case from authorisation failure. The design should make that distinction explicit:

- unauthenticated user cannot claim;
- authenticated but forbidden user cannot claim/edit;
- authorised user blocked because another identity holds lock gets `lock.denied` with holder/release info.

---

## 4.7 OpenAPI source of truth / contract tests are not in verification — Medium / High

The design says routes live in `packages/api-contract`, which is good, but the verification section does not mention:

- OpenAPI as source of truth (`API-002`);
- contract tests failing when implementation and specification disagree (`API-003`);
- generated client types from spec;
- response/request schema validation for structured errors.

The API document explicitly ranks this as important. The component editor routes should be covered by contract tests, not only service refusal unit tests.

Recommended fix:

Add verification items:

- OpenAPI includes request/response schemas for all routes and error codes;
- client types generated from OpenAPI;
- contract tests run against the implementation for create/lock/iteration/version/delete flows;
- structured error payloads are asserted, not only status codes.

---

# 5. Style/theme/font/equation/accessibility gaps

## 5.1 Which theme does a standalone component use? — High / Major gap

This is an important architectural question the design glosses over.

The design says:

> The theme is `projectCss` (themes.md), scoped to the component's container, with the tenant's typefaces.

But STY requirements say documents take themes from templates:

- `STY-024`: a theme binds catalogues and is versioned;
- `STY-025`: a template binds a theme and document takes that theme;
- `STY-066`: drafts resolve against the theme version their document is bound to.

A component may be referenced by many documents with different templates/themes. This slice edits a component “on its own,” outside any document. So which theme does it render under?

Possible answers:

1. A tenant default authoring theme, explicitly provisional;
2. The theme of the space/document context if one is known;
3. No true WYSIWYG in standalone mode until document view exists;
4. User-selectable preview theme.

The design currently implies some concrete rendering (“tenant’s typefaces”) without saying whose theme this is or whether it represents any particular document’s output.

This matters because `CNT-097` and `STY-058` require the editing view to render the theme as declared, but only for the theme being resolved. If a component can be used in documents with different themes, the standalone editor cannot show all of them at once.

Recommended fix:

Add explicit rule:

> For this slice, a component opened outside any document is rendered against [named default authoring theme / tenant default theme version]. This is not WYSIWYG for documents bound to other themes until the document view provides context. Page-break-dependent properties are shown per STY-037 or deferred to preview.

If T1 requires true WYSIWYG only in document context, state that standalone editing uses a provisional theme and record requirement impact.

---

## 5.2 “The editor resolves nothing itself” conflicts with the need for shared resolution — High / Medium

The design says:

> The editor resolves nothing itself (STY-035).

But `STY-035` requires the editor and publisher to resolve the same style from the same catalogue by the same rules. `STY-058` further says the editor must render every declared property of paragraph/character styles as the theme declares, not a sample.

If “resolves nothing itself” means it relies on some pre-projected CSS (`projectCss`) produced elsewhere, that may be fine — but only if the design identifies the shared resolution mechanism and guarantees it is the same one used by the publisher.

The code-location section currently allocates:

- `packages/editor`: ProseMirror schema/plugins/commands/node views;
- `apps/web`: thin React mount;
- `packages/domain`: content model and metadata rules;
- no explicit home for shared style/theme resolution.

If editor uses one CSS projection and publisher uses another, the two can drift while each looks correct locally. That is exactly the failure mode STY exists to prevent.

Recommended fix:

State explicitly where style resolution lives:

- either extend `packages/domain` with shared style resolution functions;
- or create a dedicated theme/style package used by both editor and publisher;
- or name `projectCss` as the single canonical projection consumed by both.

Also add tests that compare measured editor output against published output for every declared property, per `STY-053`, with an explicit approved-deviations list per `STY-060`.

---

## 5.3 Unresolvable styles/fonts/glyphs/references need explicit markers — High / Medium

`STY-070` says where a style or glyph will not resolve, the editor must render an explicit unresolvable marker rather than a silent default.

The design’s Not-owned table mentions `STY-070`, but the wording is ambiguous:

> An unresolvable style shows its marker from the theme projection; an unresolvable glyph needs font coverage the editor does not yet have.

That reads partly like it is accepted and partly like a known missing capability. As written, “the editor does not yet have” font coverage is a gap against `STY-070` unless the design explicitly defers that requirement or provides a marker anyway.

Missing details:

### Style unresolvable

If a paragraph/character/table/image/admonition style ID is present in content but missing from the selected theme version, what does the editor show?

It should not silently default. It should show an explicit marker and named error state.

### Font loading failure

`STY-040` says a typeface that cannot be loaded must fail publish and never substitute silently. In the editor, if font loading fails, the design should specify:

- marker or visual indication;
- no silent substitution;
- accessibility/contrast implications handled separately by STY rules.

### Glyph coverage

`STY-048` requires default theme to cover supported scripts/bidi/mathematics. `STY-049` says publishing must fail where a character has no glyph. The editor should at least show an explicit unresolvable marker for missing glyphs if it can detect them, or state that detection is not possible yet and how the risk is mitigated.

### Unresolved references/bindings

Cross-references/citations/variables/data bindings rendered as atoms also need unresolved behaviour. `API-049` specifically says removing a connector must make dependent bindings unavailable visibly rather than silently stale. If an inline binding’s source is gone, the editor should show a broken/unavailable atom marker, not pretend it resolves.

Recommended fix:

Add one subsection “Unresolvable content in the editor” covering:

- missing style;
- missing typeface/font load failure;
- missing glyph where detectable;
- unresolved cross-reference/citation/variable/binding;
- each with explicit visual marker, accessible name/description, and stable error code where applicable.

Add tests that no silent default occurs for these cases.

---

## 5.4 Image style resolution in editor is not specified — Medium

For existing images, `CNT-122` says the editor must resolve image styles by the same STY rules as publish time. The design defers insertion but still renders figures/images from assets. It should state how those rendered images are sized:

- named image style resolved to real dimensions;
- other dimension derived from asset intrinsic proportions;
- maximum constraint applied where declared;
- no distortion;
- explicit failure/marker when intrinsic dimensions unknown (`STY-019`).

If insertion is unavailable, the design still needs this behaviour for migrated/pasted/already-stored images.

---

## 5.5 Table page-break related styles need an explicit boundary — Low / Medium

`STY-013` says table styles declare what happens when a table breaks across a page: header repetition, continuation label, keep-together. The editor is a continuous scroll and cannot truly render pagination. `STY-037` says where the editor cannot reproduce an effect because it depends on pagination, it must not approximate silently; preview is what shows it.

The design should explicitly state which table properties are shown in the editing view and which are deferred to preview/publish:

| Property                      | Editor behaviour                                   |
| ----------------------------- | -------------------------------------------------- |
| header row/column treatment   | render as theme declares                           |
| banding/borders/rules         | render where not pagination-dependent              |
| cell padding/alignment        | render where possible                              |
| page-break continuation label | do not simulate silently; defer to preview/publish |
| repeated headers across pages | defer to publisher/preview                         |

This avoids the editor accidentally implying a pagination behaviour it cannot show.

---

## 5.6 Accessibility focus management and announcements are incomplete — High / Medium

The design covers some accessibility requirements well:

- toolbar single tab stop with arrow-key movement;
- `F6` moves surface/toolbar/metadata;
- symbol palette keyboard-navigable;
- save state change announced;
- WCAG 2.2 AA target and planned browser suite/manual audit.

But several details remain missing.

### Focus in nested/modal editors

The design includes:

- equation editing opening a LaTeX field;
- footnote node view holding a nested editor.

Need to specify:

- where focus goes when opening equation/footnote;
- whether it is modal or inline;
- how the user returns to original focus after closing/cancelling;
- how `F6` behaves while inside a nested editor;
- whether symbol palette is modal and how focus is restored.

### Announcements beyond save state

The design says change to “not saved” is announced, but other status changes need live announcements:

- lock claimed;
- claim refused with holder/release info;
- entering Recovery;
- version cut success/nothing-to-cut;
- metadata validation error appears/resolves;
- unrecoverable style/font/reference marker appears.

WCAG requires meaningful status messages to be programmatically available, not only visually shown.

### Metadata form accessibility

Metadata inputs need:

- accessible names/labels;
- required/fixed indicators exposed to AT;
- validation errors associated with fields;
- live regions for validation updates;
- user picker results distinguishable including “no longer active” state.

### Equation accessibility

Equations render as MathML carrying `alttext`, which is good. But the design should specify:

- node view is keyboard reachable;
- equation panel/editor can be opened and closed by keyboard;
- alternative text field has accessible label and required-state where applicable;
- LaTeX input probably needs `spellcheck="false"` to avoid math being underlined as prose;
- screen reader reads the alttext, not raw MathML markup.

### Browser suite release gate

The design correctly notes the repository has no browser suite yet and that this slice introduces one. But `CNT-139` requires both:

- automated accessibility suite in CI; and
- recorded manual audit against WCAG 2.2 AA before each release, result kept as evidence.

“Build plan introduces one” is not enough for T1 sign-off until the actual gate exists. The verification section should state that no release claiming `CNT-078`/`CNT-139` occurs without both pieces of evidence.

Recommended fix:

Add an accessibility subsection with explicit focus flow and live-region plan, and change Verification to say:

> Release is blocked until the automated suite passes in CI and a recorded manual audit result is attached to the release record.

---

## 5.7 RTL/bidi and base direction are missing from creation/UI — High / Medium

`CNT-059` requires right-to-left and bidirectional text support, with direction expressed in the model rather than styling. `CNT-146` makes base direction part of the content root closure.

The design says creating a component includes:

> A title, a base language (a BCP 47 picker), and a component type...

It does not mention **base direction**, even though the stored content root must include it. It also does not say:

- how an author sets RTL/LTR for a new component;
- whether existing components can change base direction later;
- how ProseMirror handles bidirectional runs and controls;
- what paragraph style alignment means in RTL context (start/end vs left/right);
- how symbol palette/keyboard shortcuts behave in RTL;
- how spellcheck false language rules interact with mixed-direction content.

Recommended fix:

Add base direction to the creation payload/UI:

```text
POST /v1/spaces/{space}/components
body includes:
  title
  component_type_id
  base_language (BCP 47)
  base_direction: ltr | rtl
  optional metadata defaults?
  Idempotency-Key
```

Add editor requirements:

- use ProseMirror text direction support;
- preserve explicit run direction where required by model;
- tests for RTL component, mixed LTR/RTL runs, bidi controls if supported.

---

# 6. Verification and release-gate gaps

The verification section is a good start but misses several categories that the requirements make mandatory or at least strongly implied.

## 6.1 Contract tests against OpenAPI are absent — Medium / High

Add explicit contract test coverage for:

- create component;
- claim/move lock;
- PUT iteration retry/duplicate/stale sequence;
- GET iterations pagination/cap/authorization;
- POST version cut success/no-change/precondition mismatch;
- DELETE lock with and without version cut;
- structured error payloads.

This supports `API-002` and `API-003`.

---

## 6.2 Paste tests must assert dropped items, not just surviving structure — Medium / High

The design says spike’s identity assertions become real tests, including paste/split/join cases. But `CNT-064` specifically requires tests to assert what was dropped as well as what survived.

Verification should include:

- Word/Markdown/HTML fixtures with hostile or unsupported content;
- assertions that scripts/event handlers/objects are not stored (`CNT-130`);
- non-allowlisted link schemes refused and named individually in report (`CNT-127`, `CNT-131`);
- empty paragraph drops counted/reported (`CNT-064`);
- internal copy re-identification assertions;
- cross-component annotation drop reports.

---

## 6.3 Schema invariant tests are missing — Medium / High

Add property/unit tests for:

- generated content round-trips `toEditor`/`fromEditor`;
- no block has null id after normalisation;
- document always contains at least one block;
- superfluous empty spacing blocks are removed/normalised per chosen rule;
- mark ids remain stable across fragmentation/split/join where required;
- copied content is re-identified correctly;
- footnote restricted schema rejects tables/images in footnote content.

---

## 6.4 Session state machine tests should include failure edges — Medium / High

The design mentions fake-service session tests: claim refused/granted, saves retried without duplicates, lock lost mid-edit, undo after reload. Good. Add:

- additional typing while Claiming;
- large paste during Claiming;
- metadata-only first change claims lock;
- iteration out-of-order/stale sequence;
- same seq with different payload hash;
- flush fails before Save version/Done editing;
- version cut refused due definition drift/fixed default change;
- same-author second window moves lock while old window has unsent steps;
- reload reconciliation where server is ahead of local sessionStorage;
- session storage corruption or invalid format.

---

## 6.5 Style conformance tests are missing — Medium / High

`STY-053` requires automated verification that every style property renders the same measured value in each output format that renders it: editor, PDF, Word. The component-editor design should at least cover the editor side and reference the shared approved-deviations list from `STY-060`.

Add tests for:

- paragraph typeface/size/weight/colour/alignment/indentation/space before-after/line spacing;
- character mark rendering per theme mapping (`STY-009`/`STY-010`);
- no silent substitution when a style/font/glyph is unresolved (`STY-070`);
- image style resolution preserving aspect ratio where images are rendered.

---

## 6.6 Performance/reference configuration for autosave cadence — Medium / Low

The open question about save cadence being unmeasured against service write budget is acceptable as an open question, but the design should state how it will be measured before changing defaults. Add a verification item:

- declare reference hardware/network/content size;
- measure autosave request rate under continuous typing/idle bursts;
- verify backoff and rate-limit behaviour;
- record result alongside provisional 2s/10s numbers, similar in spirit to `CNT-Q13` for preview.

---

# 7. Items that appear aligned or at least reasonable

To balance the review, several parts of the design are clearly on track:

## Session and version semantics

The core iteration/version/revision behaviour aligns well with CNT:

- no explicit draft save action;
- autosave as iterations;
- version cut only by positive act;
- lock timeout cuts nothing;
- undo scoped to component/session;
- cutting a version clears history/steps.

This is the right shape for `CNT-066`–`CNT-071`, `CNT-089`, `CNT-090`, and `CNT-103`.

## Lock at API

Saying every mutating component route refuses non-holders with structured error naming holder and expected release is consistent with `API-039` and the design’s own COL references. That should remain a hard requirement in tests.

## Metadata value fate

The design correctly treats metadata values as part of iterations/versions, not as free-floating form state. The service refusing only unstoreable values while saving/displaying other validation failures aligns with `MET-021` to `MET-036` and the “author mid-draft is never blocked from saving” principle.

## Spellcheck decision

The supersession of `CNT-099`/`CNT-101` by `CNT-147`/`CNT-148` is clearly reasoned. The design’s treatment of non-base-language runs with `spellcheck="false"` and the desktop shell enabling base languages through one bridge call is consistent with CNT’s final position.

## Native MathML decision for equations

Choosing native MathML in Chromium/Electron avoids a separate typesetting library in the editor and aligns well with keeping the equation payload canonical at the boundary. That part of the design is architecturally sound, provided canonicalisation/alttext gaps above are closed.

---

# 8. Recommended must-fix list before accepting this as review-ready

If I were reviewing this for acceptance, I would require either concrete changes or explicit deferrals on at least the following points:

1. **State slice scope explicitly**  
   Identify which T1 CNT capabilities are actually in this slice and which are intentionally schema-supported but not commandable yet (figures/images, cross-refs, citations, variables, bindings, hyperlinks, defined term, condition/suggestion rendering). If deferred, record requirement impact rather than leaving the surface implicitly incomplete.

2. **Resolve foreign/internal paste**  
   Either build the admission pipeline for Word/Markdown/HTML and internal copy with full reports, or explicitly mark those requirements as not met in this slice. Plain-text-only cannot silently satisfy `CNT-060`–`CNT-064`.

3. **Define content invariants**  
   Add concrete rules and tests for minimum one block, empty spacing prohibition, caption identity, footnote anchoring/key columns/restricted content, and ID allocation/re-identification for blocks/marks.

4. **Complete the session state machine failure paths**  
   Specify claim-refusal handling, pending-change queue during Claiming, metadata edit claiming/autosave/recovery, flush failures before version cut/release, and same-author lock-move handoff with unsaved local steps.

5. **Make iteration sequencing safe**  
   Add monotonic sequence enforcement, stale-sequence refusal, payload-conflict detection, reload reconciliation against server state, and explicit duplicate-retry responses.

6. **Close API contract gaps**  
   Add idempotency keys for creation/version cut where needed, version preconditions on mutating routes including iterations/release-if-cutting, pagination/cap for `GET /iterations`, request/correlation IDs, IAM 401/403 behaviour, stable error taxonomy, and OpenAPI contract tests.

7. **Specify standalone-component theme context**  
   State which theme/version a component opened outside any document renders against, whether that is provisional, and how this relates to `STY-066`/document themes. Avoid implying WYSIWYG for all documents if the component can appear under different themes.

8. **Clarify shared style resolution**  
   Identify the single resolver/projection used by both editor and publisher so `STY-035`/`STY-058` are not left to local CSS assumptions. Add measured conformance tests or reference the shared suite.

9. **Add unresolvable-state behaviour**  
   Explicit markers for missing styles, font load failures/glyph gaps where detectable, unresolved references/bindings, and no silent defaults. This is required by `STY-070` and aligns with fail-loud rules elsewhere.

10. **Complete metadata panel design**  
    Add multi-value fields, deprovisioned-user display, precise date/time offset storage, validation error shape, title/base language editing rules, component type immutability at API level, and definition-drift handling while a session is open.

11. **Resolve equation canonicalisation/alttext/engine risk**  
    State canonical stored representation (normalised MathML), whether LaTeX is persisted non-canonically, deterministic converter/canonicalisation behaviour, alttext generation for pasted/migrated/restored equations, and a decision on the speech rule engine’s licence/load model.

12. **Tighten accessibility/release gate**  
    Specify focus management for equation/footnote/symbol UI, live announcements for lock/save/recovery/version/validation states, metadata form accessibility, RTL/bidi support including base direction in creation payload, and make the browser automated suite plus recorded manual audit an explicit release gate under `CNT-139`.

---

# 9. Suggested next edit to the document

I would add or revise these sections specifically:

## In “The surface”

Add a complete content-item matrix covering every block/mark/node and whether it is create/edit/render-only/unavailable in this slice. Include hyperlinks, defined term, condition/suggestion/comment-anchor marks, admonitions, footnotes, captions, and unresolved reference markers.

Add an identity subsection for:

- new block ID allocation;
- mark ID preservation/reassignment;
- internal paste re-identification;
- external paste sanitisation/migration/refusal;
- caption ID behaviour.

## In “The session”

Expand the state table with failure columns and add subsections:

- claiming queue and refusal policy;
- metadata changes as editing events;
- lock visibility/stream scope for standalone component;
- same-author multi-window handoff;
- iteration sequence monotonicity and reload reconciliation;
- Recovery authorization/retention/restore payload.

## In “Cutting a version”

Add:

- definition-drift handling before cut;
- flush failure behaviour;
- explicit session-storage clearing after successful cut;
- structured response semantics for `version.unchanged` vs real error.

## In “Metadata alongside”

Add:

- multi-value field editor;
- deprovisioned user rendering;
- date/time UTC offset storage rule;
- validation failure shape with field/rule/artifact/schema and stable code;
- component title/base language editing rules;
- API refusal of type change before T2 explicit act.

## In “The API”

Expand route table to show:

- required/expected idempotency keys;
- version precondition fields/headers for each mutating route;
- pagination/cursor/ordering for `GET /iterations`;
- request_id/correlation_id in all responses/errors;
- rate-limit/retry-after behaviour;
- permission model and 401 vs 403 error codes.

## In “Verification”

Add explicit test categories:

- OpenAPI contract tests;
- paste report drop assertions;
- schema invariant property tests;
- out-of-order/stale iteration tests;
- definition-drift session tests;
- style measured conformance and unresolvable marker tests;
- accessibility automated CI + recorded manual audit release gate.
