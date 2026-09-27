# W4: Templates

> **A sketch**, built a pull request at a time, each test-first with one final whole-branch review
> before it opens that is asked for a break of its own against every citation. It builds W4 of
> [the rest of T1](2026-09-25-t1-remainder.md) from [templates.md](../design/templates.md), whose
> decisions TE-A to TE-L were taken as recommended on Ken's instruction of 2026-09-26 and are his to
> review at the end of W4.

**Goal:** a template is made, read and versioned; a document is made from one, keeps what it was made
from, departs from it as far as the template allows, publishes under its theme and layout, and is
refused publication while a required section or a required field is missing.

| PR   | Holds                                                                                                                                        | Version |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| W4.0 | This plan and [templates.md](../design/templates.md), claiming TPL-001, 004, 012, 013, 015, 025, 027, 053, 054, 055, 059, 062 and STR-060    | Build   |
| W4.1 | The template: its definition and check, the kind, making, reading and versioning one, its routes and permissions, development's seed         | Minor   |
| W4.2 | Making a document from a template: resolution, the starting outline with origins, seeded values, the link, the chooser; its theme and layout | Minor   |
| W4.3 | What an author may change, and values: `changes` held by the outline act, section values by `set`, document values by their own route        | Minor   |
| W4.4 | Publishing's checks: required sections and fields, refused at the door                                                                       | Minor   |

## Global constraints

- Test titles cite only what they show, checked with `pnpm trace show <ID>`, in a literal title; an
  `it.each` title cites nothing, and a `rule:` field in a test cites its requirement.
- Each test is watched fail: a new test before the code, or, where the code exists, by breaking it.
- No em or en dash in user-facing text, and no real names, addresses or paths in a fixture.
- `pnpm typecheck`, `pnpm lint`, `pnpm format`, the affected suites, then `pnpm trace generate` after
  Prettier and `pnpm trace pins`; the full suite before each pull request.

## W4.1: The template

1. **The definition** (`packages/domain/src/template/`): the zod schema and `checkTemplate` as
   templates.md gives them. **Tests:** `TPL-059 binds exactly one outline, theme and layout, and any
number of schemas` (each of the three missing or doubled refused; zero and two schemas taken);
   `TPL-012 declares the sections a document starts with, in order`; `TPL-013 marks a starting section
required`; `TPL-015 declares whether sections may be added, removed or reordered`; `TPL-054 assigns a
schema at the document's level or a section's, and can only make a field required` (no member to
   loosen, change a default or fix a value; a `requires` naming a field twice refused); uncited: keys
   unique, front matter first, a title's inline rules, no cross-reference in a starting title.
2. **`resolveTemplate`**: each unresolved reference named; effective fields per level through the
   metadata resolution. **Test:** `TPL-053 owns its outline and references its theme, layout and
schemas, resolved where used` (the outline read from the definition, the references from what the
   caller found).
3. **The kind and storage** (migration `0028_templates.sql`, `packages/db/src/templates.ts`): `template`
   a spaced kind; `createTemplate`, `readTemplate`, `templateVersion` through `createArtifact` and
   `recordVersion`. **Tests:** `TPL-001 is a named, versioned artifact in one space`; `VER-056 versions a
template by the rules content is versioned by` (a stale `openedFrom` refused, an unchanged definition
   answered unchanged, versions immutable).
4. **Routes** (`packages/api-contract/src/templates.ts`, `apps/service/src/templates.ts`): the four
   template routes of templates.md's table. **Tests:** `TPL-006 decides a template by design, not by
create or edit` (an Author refused, a Designer allowed); `IAM-018 decides a template by a grant made
on the template itself`.
5. **Seed**: development's General holds a field, a metadata schema and a template, _Report_, whose
   starting sections are Introduction (required), Method, Results and Conclusion (required).
6. Docs: architecture.md, features.md and README (templates exist and are made through the API),
   the changelog; `access.md` and `storage-and-versioning.md` gain their tests.

## W4.2: A document from a template

1. **Outline schema 3** (`packages/domain/src/structure/`): `origin` on a section node, the migration
   from 2 adding nothing, `insert` refusing it. **Test:** uncited, `an outline act never writes where a
section came from`.
2. **Materialising** (`packages/domain/src/template/`): the starting outline to section nodes with new
   identifiers, origins and seeded values. **Test:** `TPL-012 starts a document with the template's
sections, in its order` and `TPL-062 materialises the starting outline and seeds its values`.
3. **Instantiation** (`packages/db`): documents' values allowed by migration and carried by
   `DocumentSubstance`, `canonicaliseVersion`, `insertVersion` and `substanceOf` (a document version
   made before templates keeps its digest); `document_template`; and `createDocument` with a template,
   in one transaction; `template.unresolved` in the service's wire codes with TPL-004 as its rule. **Tests:** `TPL-004 refuses to make a document
while any reference does not resolve, and writes nothing`; `TPL-025 records the template and its
version`; `TPL-027 leaves the document's outline its own` (an act changes the document and not the
   template; the template's next version changes no document made); uncited, `document_template`
   refusing an update.
4. **The route and the chooser**: `POST /v1/spaces/{space}/documents` with `template`, `read` on it
   decided, an unreadable one answered as not found; **New document** offers the templates the author
   may read, and _Blank_. **Tests:** the route's refusals; the dialog making a document from a template.
5. **Its theme and layout**: `layoutLatest` and `themeLatest`; `requestPublication`, the document's view and its numbering read the
   document's template. **Test:** `STY-025 publishes a document under the theme its template binds`,
   and uncited, its layout and the page's numbering.
6. Docs as W4.1's.

## W4.3: Changes and values

1. **`changes`**: `applyOutlineOperation` given the rules, refusing an insert, a removal or a move of a
   section each forbids, references always free; `editOutline` passing the recorded version's.
   **Test:** `TPL-015 refuses adding, removing or reordering sections where the template forbids it,
and never placing a component`.
2. **Section values**: `set`'s `values` opened, each checked against the section-level fields.
   **Test:** `STR-060 gives a section field values of its own from its template's section-level
schemas` (an unknown field and a bad value refused by name).
3. **Document values**: `PUT /v1/documents/{id}/values`, checked the same way. **Test:** uncited,
   the route with its precondition and its refusals.
4. Docs as W4.1's.

## W4.4: Publishing's checks

1. **Required sections** at `requestPublication`, `section.required` in the wire codes with TPL-013 as
   its rule, and `metadata.invalid` with TPL-055. **Test:** `TPL-013 refuses to publish a document
missing a required section, naming it` (removed, and a retitled or moved one still found by its key).
2. **Fields**. **Test:** `TPL-055 refuses to publish a document whose fields, or any section's, do not
satisfy its template, naming each failure`.
3. **The page** shows either refusal where it shows a publish refusal today.
4. Docs; `templates.md`'s claims all covered; the remainder plan's W4 row reads Built.

## What the build changed

**W4.1 (PR #257).** The migration is split: 0028 makes the kind, and W4.2's 0029 the link and
documents' values, so each lands with what uses it. A request body holding a recursive schema - the
starting sections nest - left a reference in the OpenAPI document that resolved to nothing, and the
client could not be generated; the generator now moves a schema's own definitions into
`components.schemas`, held by a test that every reference resolves. `template_unresolved` is refused
when a template is made or changed as well as when a document is made from it, with TPL-004 as its
rule. Development's seed makes Ada and Grace Designers on General, which changed who plays the
Author in the route tests. The seeded **Report** assigns its Review schema with nothing required,
because no page can fill a field in until W5.

**W4.2.** The migration is `0029_document_template`, named for its table, and instantiation lives in
`createDocument` beside a blank document's, with `documentTemplate`, `documentLayout` and
`documentTheme` in `templates.ts`. A document version's `values` is optional in its substance and left
out when empty, so a document with none serialises as every earlier one did; an outline act carries
the values forward, held by a test, since leaving them out would have cut a version that quietly
dropped them. `createArtifact` makes no theme or layout, so the tests binding a second one copy the
environment's rows under a new artifact. A document's view names its template only where the caller
may read it, null otherwise, as for a blank document.

**W4.3.** Values written are checked by `checkWrittenValues` and stored by `writtenValues`, in the
metadata package beside `validate`, and a field outside the level's fields fails a new rule,
`unknown`. A value written whole takes the default of each field it leaves out, as `carryForward`
does, so a fixed value survives any write and a field is emptied by its clear. A write to a document
whose template no longer resolves is refused as `values_unresolved`, not `template_unresolved`,
because that code's rule is TPL-004's, about making a document; neither values code names a rule.
The document's view carries its own values. As designed (TE-D), `remove: false` holds every section,
an author's own included.

## Done when

- Every requirement templates.md claims is Covered, and STY-025, VER-056, TPL-006 and IAM-018 are cited
  in the designs that claim them.
- The remainder plan's W4 row reads Built with the five PR numbers, and Ken has reviewed TE-A to TE-L.
