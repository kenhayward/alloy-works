# TP2: Parameters feeding bindings

> TP2 of [templates.md](../design/templates.md#parameters)'s build order, the last, on what TP1 built
> ([its plan](2026-10-07-tp1-template-parameters.md)). **Full tier**: it changes how a binding's
> identity is computed wherever it is compared, so a pre-flight review (done, folded in) and a final
> review; no per-task reviews. The plan rides in TP2.1 (ADR-0039). Ken may overrule.

**Goal:** a binding's `{ document: name }` argument takes the document's current parameter value at
resolve and check; a binding's digest is taken with its document arguments substituted, so changing a
parameter marks exactly the bindings that read it changed, and the Data tab says which parameter; the
publish refuses them until resolved and accepted; the Value dialog's From the document offers the
template's argument parameters of the right type. With it, T2's data work is complete.

| PR    | Holds                                                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------------------- |
| TP2.1 | This plan; substitution in the domain and in `bindingsPlaced`; resolve and check; the publish request; Report's seed |
| TP2.2 | The Value dialog's From the document; the Data tab's reason; the whole system; TP2's close                           |

## Decisions

| #     | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Beat                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| TP2-A | **`substituteDocumentArguments(binding, parameters)`**, pure, in `data/binding.ts`: each `{ document: name }` with a value becomes `{ literal: value }`; one without, or with an empty list, stays as it is; a binding with no document argument is returned unchanged, so its digest and every resolution held today stay as they are. **The substitution is made in one place, `bindingsPlaced`** (`apps/service/src/data/bindings.ts`), which already reads the document version: `Placed.digest` is taken over the substituted binding and `Placed` gains `parameters`, so every comparer that reads `Placed.digest` - resolve, pending and settle, check, accept, confirm, Keep, `sincePublished`, `mayCheck`, `takesAsked`, the dataset read, the view's stale check - compares like with like. **`Placed.binding` stays as written**: the view returns it and the page and editor compare it with their own unsubstituted binding, so those client sites need no change and never call a binding stale (the server decides `stale`) | A second digest column; substituting in each comparer                             |
| TP2-B | **The parameters substituted are the document's latest version's**, everywhere, `bindingsHeld` in the publish request included: a request may only publish the latest version (`version.precondition`), and a request already queued holds its digests, which the worker never recomputes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | A per-version read that no request can need                                       |
| TP2-C | **At resolve and check**, `literalValues` takes the substituted values (all of them, not the first); an argument left unsubstituted is `parameter_invalid`, rule `required`, naming the definition parameter. **A document parameter whose declaration does not feed arguments, or whose type or `list` is not the definition parameter's, is `parameter_invalid`** naming the parameter and the rule (`feeds` or `type`) and nothing of the declaration, since the caller may not read the template (TP1's M2). The declaration is read by a light reader beside `boundBy` in `packages/db/src/templates.ts` (the recorded version's `parameters` only, never `documentRules`). The value is then checked against the definition's own declaration (DAT-020). D3-L's blanket refusal goes                                                                                                                                                                                                                                                 | `documentRules` on every resolve; a refusal showing a declaration to a non-reader |
| TP2-D | **On the server, `questionUnchanged` compares substituted bindings**, so Keep carries a held value across a change leaving the substituted question the same. **In the Value dialog**, which has no document parameters for a component alone, the question is unchanged where query, version and the parameters' spelling (`canonicalJson`) are the same; `question.test.ts`'s "document never unchanged" is rewritten                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | One comparison for both, which the dialog cannot make                             |
| TP2-E | **The Data tab's reason**: for each `{ document: docName }` at definition parameter `defName`, the view compares `provenance.parameters[defName]` with the document's `docName`, by `canonicalJson`, and answers `parameters: docName[]` that differ; a binding also changed by its component keeps both reasons. The tab says "The document's issued changed"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Comparing names across the two namespaces                                         |
| TP2-F | **The Value dialog's From the document** reads the declarations from `GET /v1/documents/{id}/parameters` (`DocumentParametersView`, which only a template reader receives), handed to the component editor by the document page: a choice of the parameters that feed arguments and match the definition parameter's type and `list`; without declarations, the dialog says it cannot offer them and takes a typed name. In a component alone, a typed name held to `parameterName`. A binding holding `{ document }` opens with it chosen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Reading declarations from `DocumentView`, which has none                          |
| TP2-G | **Development's Report gains `period`**: a changeable date that seeds the Period field and feeds arguments, in a new template version found by name, so the browser test, the by-hand pass and TPL-066's test have a parameter doing both                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Each suite building its own template                                              |

## Task 1: Substitution, resolve and the publish (`packages/domain`, `apps/service`, `packages/db`) - TP2.1

- TP2-A in `data/binding.ts` and `bindingsPlaced`; TP2-C in `literalValues`, `prepare`, `keepable`,
  confirm, the light declaration reader; TP2-D's server half; `bindingsHeld` (TP2-B); the D3-L
  refusal removed; TP2-E's view member; TP2-G in `dev-content.ts`; the contract and the client.
- Tests: **`DAT-030`** a binding's `{ document }` argument resolves to the document's parameter value
  through the API. **`TPL-066`** `period` seeds its field when the document is made and supplies the
  argument of a binding placed in it; changing it marks that binding changed. Uncited: a binding
  without document arguments keeps its digest (pinned against a stored resolution); rewriting
  `{ document: 'issued' }` as the same literal keeps the digest; A to B and back to A is holding again;
  an argument the document lacks, or an empty list, is `required`; a parameter not feeding arguments,
  or of another type or list, refused naming no declaration; the value checked against the
  definition's narrower permitted values; changing a parameter makes exactly its bindings changed,
  and the publish refuses `binding_unresolved`, reason `changed`, until resolved and accepted; a
  request queued before the change still publishes; Keep across an unchanged substituted question,
  refused across a changed one; a parameter changed mid-resolve makes the settle refuse, and a
  re-resolve takes the new value; the view names the changed parameter.
  `bindings-routes.test.ts:940` retitled (a blank document's refusal is now `required`), and
  `binding.test.ts:443` to the new `literalValues`.

## Task 2: The page (`apps/web`) - TP2.2

- `ValueDialog.tsx` (TP2-F, TP2-D's dialog half), the document page handing the declarations,
  `bindingContexts.ts` and `DataTab.tsx` (TP2-E's words), dash-free.
- Tests (jsdom): the dialog offers only matching argument parameters and writes `{ document }`; a
  reader without the template's declarations is told why and may type a name; a component alone takes
  a typed name; a binding with `{ document }` opens with it chosen; a take change on a `{ document }`
  binding does not warn holders; the Data tab says which parameter changed.

## Task 3: The whole system, docs and the close - TP2.2

- `tests/browser`: by keyboard, make a document from Report with `period`, place a value whose
  definition takes a date from the document, change `period`, read the Data tab's reason, check and
  accept, publish; axe on the dialog. `tests/e2e`: the same over HTTP.
- Docs: templates.md (as built), bindings.md (DAT-030's dialog half, the substituted digest), data.md
  (D3-L's refusal gone), features.md and the README, the plans index. The close per ADR-0037: 0.144.0,
  its baseline with DAT-030 and TPL-066.

## Verification

- Each suite alone, then `pnpm test`, `typecheck`, `lint`, `format`; `pnpm trace check` and `pins`
  after `generate`, which runs after prettier.
- `pnpm test:e2e` and `pnpm test:browser` against the build's own compose project
  (`-p alloy-tp2 --profile sources`), every `ALLOY_TEST_*`, `ALLOY_E2E_*` and `ALLOY_BROWSER_*`
  target set. Never Ken's `alloy-works` stack.
- **The final review** breaks each citation; probes a binding with two document arguments, one
  changed; a list parameter into a list argument; an empty list; a parameter renamed in a later
  template version; a document with no template holding a `{ document }` binding; a stored
  resolution's digest unchanged; Keep across a change; a pasted component's `{ document }` binding in
  another document whose template lacks the parameter; the mid-resolve settle.
- **By hand**: change `period` in the real app and follow the Data tab to a publish.

## Risks

- **Digest compatibility** could strand every held value; TP2-A leaves a binding without document
  arguments unchanged, and a test pins a stored resolution's digest.
- **A comparer outside `bindingsPlaced`** would call held values changed; the census found
  `bindingsHeld` alone, which TP2-B covers.

## Questions for Ken

None: templates.md's decisions are taken. The plan rides in TP2.1.

## Changed while building

| PR    | Found                                                                                          | Change                                                                                                                                                                                                             |
| ----- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TP2.1 | `ParameterRule` keys the page's `PARAMETER_WORDS`, and `feeds` is no value's rule              | `feeds` is the contract's rule alone, beside the others in a refusal's `problems`; the domain's `ParameterRule` is unchanged, and the page's words for it are TP2.2's                                              |
| TP2.1 | `feeds` and `type` could name either parameter                                                 | They name the document's parameter, whose fault it is; `required` names the definition's, which has no value                                                                                                       |
| TP2.1 | Comparing whole types would refuse a decimal of another precision whose value fits             | `argumentRefusal` (domain, for TP2.2's dialog too) compares the base type and `list`; anything narrower is the definition's check of the value                                                                     |
| TP2.1 | `literalValues` left the definition's own `required` beside each argument without a value      | It answers `fromDocument`, every argument unsubstituted; each is `required` once, and the definition's problems for it are dropped                                                                                 |
| TP2.1 | TP2-E's member had no home                                                                     | `held.parameters`, optional, present only where the binding is stale and a parameter it reads differs from the held provenance                                                                                     |
| TP2.1 | Report's `period` needs a document-level date field                                            | A Reporting schema holding Period, assigned by Report beside Review; a Report lacking any of its parameters or schemas is given them as one new version                                                            |
| TP2.1 | The bindings harness seeds nothing of development's                                            | `startHarness({ development: true })` seeds it once everyone has signed in, and `documentReferencing` takes a template and parameters                                                                              |
| TP2.2 | TP2-D's dialog half needs a comparison the server's `questionUnchanged` must not make          | `questionSpelledAlike` (domain) compares query, resolved version and the parameters' `canonicalJson`, a null literal left out; `questionUnchanged` keeps refusing an unsubstituted argument, its test split in two |
| TP2.2 | TP2-F named no route for the declarations from the page to the dialog                          | The Parameters panel tells the page what it read (`onDeclarations`), and the page hands a `DocumentOffer` through `ComponentEditor`: no second read                                                                |
| TP2.2 | "Without declarations" is several cases                                                        | The dialog says why for each - a component alone, a template the reader may not read, a document holding no parameters, not read, none fitting - and each takes a typed name                                       |
| TP2.2 | A resolve refused `parameter_invalid` read as a failed fetch, and `feeds` had no words         | `settleBinding` says each problem: `feeds` and `type` by the document's parameter (`ARGUMENT_WORDS`), the rest by the value's own (`PARAMETER_WORDS`)                                                              |
| TP2.2 | Task 3's "check and accept": a check leaves a changed binding unchecked (`unresolved`)         | The browser and e2e tests resolve it again, from the Data tab and over HTTP, then publish                                                                                                                          |
| TP2.2 | axe over the page with the dialog open flags a Report's scrolling text, inert behind the modal | The browser test checks the dialog `within` itself, and the Data tab over the whole page                                                                                                                           |
