# STY - Styles and presentation themes

> **Status: draft, for review.**

## 1. Purpose

What things look like, held apart from what they say. This area owns the named style catalogues an
author selects from, the themes that bind those catalogues together, and the rule that both the
editor and the publisher resolve the same style from the same place.

It exists because appearance turned out to belong to neither end. An author picks a style while
writing and a publisher resolves it while rendering, so the catalogue itself is a third thing, and
until it had somewhere to live both ends were assuming it.

## 2. Depends on

| Rests on                                            | What it fixes                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| [`Project_Scope.md`](../Project_Scope.md) §6, §7.18 | Style catalogues, themes, the separation from publishing layout                  |
| [CNT](CNT-content-and-authoring.md)                 | Content carries no appearance; the closed mark set; the editor renders the theme |
| [AST](../Project_Scope.md) §7.20                    | An asset's intrinsic dimensions, without which an image style cannot resolve     |

| Not here                                                 | There   |
| -------------------------------------------------------- | ------- |
| Page size, margins, running heads, pagination            | **PUB** |
| Which theme a document uses                              | **TPL** |
| Per-column field formatting in a specific table          | **TAB** |
| Where an asset's dimensions come from                    | **AST** |
| Which citation style set is available and how it renders | **PUB** |

## 3. Styles and catalogues

| ID          | Requirement                                                                                                                                | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **STY-001** | A style must be a named appearance definition belonging to a catalogue                                                                     | T1         | Specified |
| **STY-002** | A catalogue must be a versioned artifact within a tenant, usable by more than one space                                                    | T1         | Specified |
| **STY-003** | There must be a catalogue for each of: paragraph, character, table, image, admonition and citation styles                                  | T1         | Specified |
| **STY-004** | Content must reference a style by identity and must carry no appearance of its own                                                         | Constraint | Specified |
| **STY-005** | Every style must have a stable identifier, allocated once and never reused                                                                 | T1         | Specified |
| **STY-006** | A style must declare what it may be applied to, and applying it to anything else must be refused rather than ignored                       | T1         | Specified |
| **STY-007** | A style should be able to derive from another and inherit its unstated properties; the chain must be finite and must be checked for cycles | T2         | Specified |

## 4. Paragraph and character styles

| ID          | Requirement                                                                                                                                                                            | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **STY-008** | A paragraph style must be able to declare typeface, size, weight, colour, alignment, indentation, space before and after, line spacing, and keep-with-next and keep-together behaviour | T1         | Specified |
| **STY-009** | A character style must declare how each mark in CNT-031 renders                                                                                                                        | T1         | Specified |
| **STY-010** | That mapping must be per-theme, so that `strong` may render bold in one theme and as small capitals in a house style that says so                                                      | T1         | Specified |
| **STY-011** | Alignment must be a property of a paragraph style and must not be offerable as a free per-block control (CNT-094)                                                                      | Constraint | Specified |

**STY-010 is what makes the closed mark set in CNT tolerable.** An author is choosing meaning and
the theme is choosing appearance, so the constraint costs them nothing they actually wanted: they
asked to make a phrase stand out, and it does.

## 5. Table styles

| ID          | Requirement                                                                                                                                                        | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | --------- |
| **STY-012** | A table style must declare header row and column treatment, banding, rules and borders, cell padding, and alignment by column type                                 | T1      | Specified |
| **STY-013** | A table style must declare what happens when a table breaks across a page: whether headers repeat, what continuation label appears, and what must be kept together | T1      | Specified |
| **STY-014** | A table style must declare default field formatting by column type - number, currency, percentage, date, unit - which a specific table may override (**TAB**)      | T2      | Specified |

**STY-013 is a style rather than a layout property on purpose.** How a table behaves at a page break
is a property of the kind of table it is - a dense data table and a two-row summary want different
answers - and it travels with the table wherever it is used.

## 6. Image styles

| ID          | Requirement                                                                                                                                                                               | Tranche    | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **STY-015** | An image style must declare which dimension it fixes and at what value                                                                                                                    | T1         | Specified |
| **STY-016** | Resolving an image style must derive the other dimension from the asset's intrinsic proportions, and must never distort an image                                                          | Constraint | Specified |
| **STY-017** | An image style must declare a maximum in the dimension it does not fix; where that would be exceeded the image must be constrained by that dimension instead, still preserving proportion | T1         | Specified |
| **STY-018** | An image style must declare placement: inline with text, block, or floated, with alignment                                                                                                | T1         | Specified |
| **STY-019** | Resolving an image style must fail with a named error where the asset's intrinsic dimensions are not known (**AST** records them on ingest)                                               | T1         | Specified |

**STY-016 comes from having been burned by it.** Fixing both dimensions distorts the picture, and it
does so silently - nothing errors, nothing warns, and the first person to notice is a reader. Fixing
one and deriving the other is the only version that cannot go wrong quietly.

## 7. Citation styles

| ID          | Requirement                                                                                                 | Tranche | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **STY-020** | A citation style must declare both the in-text form and the bibliography form                               | T6      | Specified |
| **STY-021** | The set must include at least CSE, Vancouver and Harvard (CNT-102)                                          | T6      | Specified |
| **STY-022** | A citation style must declare ordering, and how two sources that would render identically are disambiguated | T6      | Specified |
| **STY-023** | Adding a citation style must be possible without a code change                                              | T6      | Specified |

## 8. Themes

| ID          | Requirement                                                                                                                                | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **STY-024** | A theme must bind one catalogue of each kind, and must be a versioned artifact                                                             | T1         | Specified |
| **STY-025** | A template must bind a theme (**TPL**), and a document must take the theme its template binds                                              | T1         | Specified |
| **STY-026** | Moving a document to a different theme must be an administrative act, never an authoring one, and must be audited                          | T2         | Specified |
| **STY-027** | Where a document references a style the theme does not contain, publishing must fail with a named error rather than substituting a default | Constraint | Specified |
| **STY-028** | A baseline must pin the theme version it published under, so that re-publishing an approved document cannot change how it looks            | T3         | Specified |

**STY-027 is the same rule this repository already learned about icons.** A missing asset that
silently substitutes a default produces output that is wrong and looks deliberate, and nobody finds
it until a reader does. Failing loudly is the only behaviour that surfaces the problem while
somebody can still fix it.

**STY-028 matters more than it sounds.** Without it, approving a document approves how it looked on
one day, and a theme change months later re-renders something that was signed.

## 9. Extension and administration

| ID          | Requirement                                                                                                                     | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **STY-029** | An administrator must be able to add a style to a catalogue without a code change or a release                                  | T2      | Specified |
| **STY-030** | A style added that way must immediately be selectable by authors and honoured by every output format                            | T2      | Specified |
| **STY-031** | A style must not be deletable while anything references it, and its uses must be listable                                       | T2      | Specified |
| **STY-032** | Adding, changing and deleting a style must be audited, including what changed                                                   | T2      | Specified |
| **STY-033** | A tenant must be able to restrict which styles authors may choose, so that a catalogue can hold more than a house style permits | T2      | Specified |
| **STY-034** | Changing a style must show what it will affect before the change is made                                                        | T2      | Specified |

## 10. Resolution

| ID          | Requirement                                                                                                                                           | Tranche    | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **STY-035** | The editor and the publisher must resolve the same style from the same catalogue, by the same rules                                                   | Constraint | Specified |
| **STY-036** | The editor must render typefaces, sizes, colours and spacing as the theme declares (CNT-082, CNT-097)                                                 | T1         | Specified |
| **STY-037** | Where the editor cannot reproduce an effect because it depends on pagination, it must not approximate it silently; preview is what shows it (CNT-095) | T1         | Specified |
| **STY-038** | Style resolution must be deterministic: the same content, style and theme version must always produce the same appearance                             | Constraint | Specified |

## 11. Typefaces

| ID          | Requirement                                                                                                                               | Tranche    | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **STY-039** | A theme must declare the typefaces it uses, and each must be available in a browser, in the desktop shell, and in the publishing pipeline | T1         | Specified |
| **STY-040** | A typeface that cannot be loaded must fail the publish, and must never be substituted silently                                            | Constraint | Specified |
| **STY-041** | A theme must record the licence under which each typeface is held, and whether that licence permits embedding it in published output      | T1         | Specified |
| **STY-042** | Publishing must refuse to embed a typeface whose licence does not permit it, and must say so rather than quietly substituting             | T1         | Specified |

**Section 11 is the open font question from the architecture work, arriving where it belongs.** The
constraint that made it hard has not changed: one typographic system has to work in a browser tab,
in an Electron window loading over `file://`, and in whatever renders the PDF. What is new is
STY-041 and STY-042 - embedding a typeface in a published document is a licensed act, and a product
that embeds without checking has made its customers' licensing problem into its own.

## 12. Interchange

| ID          | Requirement                                                                                              | Tranche | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **STY-043** | A catalogue must be exportable and importable, so that a house style can move between spaces and tenants | T2      | Specified |
| **STY-044** | An import must report anything it could not represent rather than dropping it                            | T2      | Specified |

## 13. Non-requirements

| ID          | Not this                                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **STY-N01** | **No per-document and no per-author overrides.** A document that needs a different look uses a different theme (CNT-N08)                                                                                           |
| **STY-N02** | **No page geometry.** Size, margins, running heads and columns belong to the publishing layout                                                                                                                     |
| **STY-N03** | **No stylesheet or code supplied by a tenant.** Extension is declarative, from a fixed set of properties. Arbitrary style code would be an injection surface and would make every output format a rendering engine |
| **STY-N04** | **Not a design tool.** A theme is configured, not drawn                                                                                                                                                            |

## 14. Open questions

| ID          | Question                                                                                                                                                              | What would settle it                                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **STY-Q01** | **Are catalogues tenant-wide, or per space?** A consultancy working for two clients may need two house styles that authors must not confuse                           | Whether early customers serve more than one end client from one tenant. Likely yes in this market                                               |
| **STY-Q02** | **Does STY-N03 survive a real house style?** Declarative properties cover most of typography and none of the last five per cent somebody's brand guideline insists on | The first house style that cannot be expressed. The answer is probably to widen the declared property set rather than open an escape hatch      |
| **STY-Q03** | **Who supplies typefaces, and who holds the licence?** A customer's brand font is licensed to the customer, not to this product                                       | A decision with commercial as much as technical weight: whether a tenant uploads fonts it has licensed, and what the product asserts about that |
| **STY-Q04** | **Does a theme need variants - screen against print, light against dark?** Reading a document on screen and printing it may reasonably differ                         | Whether the editor's rendering of the theme (STY-036) turns out to be legible for long reading                                                  |

## 15. Traceability

| This document      | Rests on                                                                   |
| ------------------ | -------------------------------------------------------------------------- |
| Section 3          | Scope §7.18                                                                |
| STY-010, STY-011   | CNT-031, CNT-035, CNT-094 - the closed mark set and named styles           |
| STY-015 to STY-019 | CNT-088, CNT-091, CNT-092; asset dimensions from §7.20                     |
| STY-027, STY-040   | Scope §11 and this repository's own icon rule: never substitute in silence |
| Section 11         | The open typography question carried from the architecture work            |
| STY-N01            | CNT-N08, no per-document override                                          |
