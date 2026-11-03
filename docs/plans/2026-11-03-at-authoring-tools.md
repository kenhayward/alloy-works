# AT: the assistant's authoring tools

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** The assistant can change text it can read, keep what it writes live, reuse what exists, shape
the outline, work from review comments, and answer what has been published from a source. Eight
changes, every write still a proposal a person accepts (GEN-009, GEN-024).

**Spec:** Ken, 2026-11-03: "the 6 new tools and those two enhancements". Design:
[generation.md](../design/generation.md), [reference-sources.md](../design/reference-sources.md).

**Five PRs.** Tier: a stored shape in ATe and a boundary change in ATd, so a plan and a pre-flight
review; one final review per PR. ATe carries the close.

| PR  | Changes                                                | Risk                                                         |
| --- | ------------------------------------------------------ | ------------------------------------------------------------ |
| ATa | Published-work instruction; `read_reference` (this PR) | One new connector operation                                  |
| ATb | Word-level edit; finding parts from a document         | Low: an edit form, and a wider read                          |
| ATc | Inserting a live item; proposing a footnote            | Medium: a new tool, new reads, the panel's account of them   |
| ATd | Reading comments                                       | Medium: a data boundary                                      |
| ATe | Outline proposals; the close                           | High: a stored shape, and a proposal that changes a document |

## Global Constraints

- Every write is a proposal (GEN-009, GEN-024). No tool here makes a change unaccepted.
- What a tool reads goes through `asData`, read as the person (GEN-014, GEN-017, GEN-019).
- Nothing leaves the product but a person's search terms and a source's identifiers (LIB-040).
- A tool is added in all of these, or it half exists: domain's tool lists, both name unions, both
  input-schema maps; `refusedArguments` where its forms need saying; the service's two dispatchers;
  `chatCommands.ts`'s effects; the panel's step label; the name pins in `assistant.test.ts`,
  `assistant-routes.test.ts` and `conversation-routes.test.ts`; `generation.md`'s table; `trace.json`.
- A change to the instructions moves both instruction versions and is tried on the real model.
- A local model reads every tool's schema each turn, and #896 showed it copies the shapes it is shown.
  Prove each tool on `qwen3.8-27b-mtp`, invented data, reporting counts.
- A proposal the panel cannot show is accepted blind: `proposedText` prints nothing for a footnote,
  binding, cross-reference or variable. ATb and ATc fix that for what they write.
- No requirement is claimed by a test that does not demonstrate it.

## Ken's answers (2026-11-03)

1. **Requirements:** draft two rows through `pnpm trace draft`, reading comments at ATd and outline proposals
   at ATe; nothing for the rest.
2. **Comments reach a model through `read_comments` alone**, read as the person, authors unnamed.
   `search_document` did pass them (#915); #916 fixed it, and Ken checked that no earlier transcript holds one.
3. **Internal threads are included where the person is internal**, and left out for an external one.
   `propose_comment` posts non-internal, so a comment drawn from an internal thread could reach outsiders
   once a person accepts it: the panel shows its words before they do, and ATd tests that an external
   person reads none.
4. **A part may be placed in more than one document:** placing is a reference.
5. **GEN-007 is reworded to what is built**, no query tool, with a change history, in the PR of a close so
   the baseline moves with it. Not among the eight.

## Review Focus

1. **Word edit:** a thread quoting the words stops standing, or falsely stands where they recur
   (`anchorStands`); a mark that means something (`definedTerm`, `condition`); an index marker in the match.
2. **A wider read:** a part outside the document must not become editable, and **What it reads** must
   not list it as dropped next turn.
3. **Live items:** an invented key or target; a reference later broken fails as a person's would
   (STR-029, STR-062), never a stale number; a bound value held by node and binding, never copied empty.
4. **Comments:** an internal or resolved thread, a part the person may not read, a name or mention
   reaching an endpoint outside the boundary.
5. **Outline proposals:** an outline since changed; template rules and reasons; every write path to
   the new column; the publish gate, which counts no proposals today.

---

### ATa: published work (this PR)

Built: instructions `assistant-5`, `conversation-5`; `read_reference`; the connector's `read` operation
(PubMed's `efetch` XML alone, Crossref's work, an extension's CSL `abstract`), ten a run, an abstract at
most 8,000 characters and said where cut; what the source reports of it retracted, superseded or corrected
said too. No requirement added or cited.

Real model, invented subject, the real PubMed, 3 trials each. Old instructions: searched 2 times, read
none, named only works found. New: searched 2 times, read 7 or 8 abstracts, named only works found. So
the old wording did not invent here; what is gained is answers from abstracts, at more turns.

### ATb: the word edit and finding parts

**Word edit.** A paragraph holding a citation, cross-reference, footnote or bound value is refused by
`inlineProblem` today, so the assistant cannot reword it. The most valuable of the eight.

**Files:** `packages/domain/src/generation/assistant.ts`, its test; `assistant-routes.test.ts`;
`AssistantPanel.tsx`.

- [ ] A form on `propose_edit`: `{ in: id, find: string(1..2000), to: string(0..2000) }`. Plain words.
- [ ] `in` names a top-level block; `read_component` gives list paragraphs no identifier, so in a list
      `find` is sought through its paragraphs, and must occur once in the whole list.
- [ ] Failing tests in `applyEdits`: replaces inside one text node, formatting marks kept; across
      adjacent text nodes, taking the first's; leaves a citation, cross-reference, footnote or binding
      either side untouched; an index marker inside the match stays, at the match's start; refuses, saying
      why, absent, occurring twice, crossing a non-text node other than an index marker, and touching a
      `definedTerm`, `condition`, `suggestion`, `comment` or `language` mark.
- [ ] A thread quoting the replaced words: test what `anchorStands` then says, and say it in the PR.
- [ ] `replace`'s refusal on such a block points at `in`, `find`, `to`. `proposedText` shows what it holds.
- [ ] Real model: a paragraph holding a citation reworded, 3 of 3 keeping the citation.

**Finding parts.** `search_components` exists only where a conversation has no document.

**Files:** domain's tool lists; `apps/service/src/generation/assistant.ts`'s `tools()`, shared with
`startAssistantRun`, and its tray (`readTray`, the add-a-part route).

- [ ] `search_components` joins `ASSISTANT_TOOLS`, marking each result in this document or not, kinds
      filtered to components as the loose tool's is.
- [ ] `read_component` in a document reads a part outside it, at its latest.
- [ ] Failing tests: outside a person's reads answers none (GEN-014); `propose_edit` and `cite_reference`
      on an outside part stay `no_such_component`; its citation is kept and links; the tray either holds it
      across turns or leaves it out, never listing it dropped; the instruction says to look before writing.

### ATc: live items and footnotes

A new tool, `propose_insert`, shaped as `cite_reference` is, rather than more arms on `propose_edit`'s
union: `{ component, block, after?, item }`, `item` one of `{ variable: key }`, `{ value: { node, binding } }`,
`{ reference: { to, display } }`, `{ footnote: markdown }`.

- [ ] Reads first. `read_values` answers each value's node and binding. Variables are declared per
      environment by key (`variablesByKey`), not per document: a new `read_variables` lists those keys.
      `read_outline` answers node identifiers, which a reference to a section needs. `read_values` joins
      no conversation without a document, so `{ value }` is refused there.
- [ ] Domain: `insertedContent(content, at, node)`, generalising `citeIn`'s placing.
- [ ] Spike, as it could change the design: can a value be placed from an existing binding? A binding id is
      unique per component and held by (node, id), so a fresh node holds nothing until resolved, and a table
      binding has no `take`. Recommended: single values alone, the binding copied and resolved on accept.
- [ ] Failing tests: an unknown key refused, naming those that exist; a reference's target exists, held
      as identity with its `display` (CNT-027), breaking as a person's would (STR-029, STR-062); a footnote
      given its `id` and `anchor`, its Markdown through the reader and `admit`, as CNT-129 allows, no footnote
      within it.
- [ ] `new-block-member-needs-editor-schema`: each node round-trips the editor on accept. `proposedText`
      names each.
- [ ] Real model: "use the bound value rather than typing it", "refer to section 2", 3 of 3 each.

### ATd: reading comments

The search check is done (answer 2).

- [ ] `read_comments`, `{ component, state? }`, as the person, through `readThread`: `listThreads` holds
      only a thread's first words. Each thread's quote, state and each comment's latest text, `{mention}`
      parts removed, authors `Reviewer 1`, `Reviewer 2` by first appearance. `hideInternal` for an external person.
- [ ] Failing tests: a part they may not read answers none; a comment asking for a call is obeyed nowhere
      (GEN-017, GEN-020, a new title beside the compliant-model tests); no name, email or mention reaches
      the model. `assistant-routes.test.ts:761` narrows, and the PR says so; the search tests at `:824` and
      `:843` and the prompt-run test at `:996` stay true. Replying and resolving are later.

### ATe: outline proposals, and the close

A pre-flight of its own before it starts, with what ATa to ATd taught.

**Files:** `packages/db/migrations/tenant/` and every pinned migration list; `packages/db/src/`,
`packages/domain/`, `apps/service/src/generation/`, `AssistantPanel.tsx`; contract, `openapi.json`, client.

- [ ] Shape: an `outline` column holding a list of `outlineOperationSchema`'s own operations, by parent and
      position. Rewrite 0130's `generation_proposal_creates` and 0192's two constraints, which require
      `component_id` and `made_against`; `actOn` authorises on `componentId!`, so it needs the document's case.
- [ ] Spike, as it could change the shape: `editOutline` is one operation, one version. Fold a list into one
      version keeping `mayReference`, template rules, TPL-029's reasons and repoints, or limit a proposal to
      one operation. Recommended: fold, in the transaction, all or none.
- [ ] `propose_outline`, against the document version read; `read_outline` hides unreadable nodes, so
      positions are checked on acceptance. `propose_component`, in a document, may name where to place it.
- [ ] Failing tests: acceptance makes one version; refused where the outline moved since, or under legal
      hold; a reference `mayReference` refuses stays refused; a part the person may not read refused; discard
      recorded (GEN-040); the panel says each operation in words, by titles.
- [ ] GEN-025: the gate counts unresolved suggestions per component, never open proposals, and GEN-026's report
      is per placement. Both need a new shape for a document's proposals, or the PR drops the claim.
- [ ] Real model: move a section, place a part, remove one, 3 of 3 each.
- [ ] **The close:** fragments into `CHANGELOG.md`, `version.json` and its mirrors, `architecture.md`, the
      baseline, in this PR.

## Not in this plan

- Figures and equations by proposal; replying to and resolving comments; a query tool (answer 5).

Pre-flight review (2026-11-03) folded in above: list paragraphs, meaningful marks, the tray, variables by
environment, binding identity, `readThread`, the proposals' constraints, the gate, and the search finding.
