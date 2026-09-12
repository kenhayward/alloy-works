# STY - Styles and presentation themes

> **Status: v1, reviewed.**

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

| ID          | Requirement                                                                                                                                                                                          | Tranche    | Status                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------- |
| **STY-001** | A style must be a named appearance definition belonging to a catalogue                                                                                                                               | T1         | Specified             |
| **STY-002** | A catalogue must be a versioned artifact within a tenant, usable by more than one space                                                                                                              | T1         | Specified             |
| **STY-003** | There must be a catalogue for each of: paragraph, character, table, image, admonition and citation styles                                                                                            | T1         | Specified             |
| **STY-004** | Content must reference a style by identity and must carry no appearance of its own                                                                                                                   | Constraint | Specified             |
| **STY-005** | Every style must have a stable identifier, allocated once and never reused                                                                                                                           | T1         | Specified             |
| **STY-006** | A style must declare what it may be applied to, and applying it to anything else must be refused rather than ignored                                                                                 | T1         | Specified             |
| **STY-007** | A style should be able to derive from another and inherit its unstated properties; the chain must be finite and must be checked for cycles                                                           | T2         | Superseded by STY-056 |
| **STY-056** | A style must be able to derive from another and inherit its unstated properties. The chain must be finite and must be checked for cycles                                                             | T2         | Specified             |
| **STY-057** | Resolving a derived style must take each property from the nearest ancestor that states it, and the resolved set - every property and where it came from - must be inspectable (STY-035)             | T2         | Specified             |
| **STY-061** | Every named error in this area must carry a stable machine-readable identifier as well as a human message, so that it can be cited in documentation, matched in automation and counted (**API-005**) | Constraint | Specified             |

**STY-056 replaces STY-007 because "should" left inheritance optional and nothing else covered its
absence.** An implementer could have dropped derivation and failed no requirement, while STY-035 -
the editor and the publisher resolving by the same rules - would have had two possible sets of rules
to be the same about. **STY-057** says what resolution does with a chain, and makes the answer
inspectable rather than inferred from output.

**STY-061 is small and this document needed it.** "A named error" appears five times as the
behaviour that keeps a failure loud; a name only a human reads cannot be asserted in a test or cited
in a support conversation.

## 4. Paragraph and character styles

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                                         | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **STY-008** | A paragraph style must be able to declare typeface, size, weight, colour, alignment, indentation, space before and after, line spacing, and keep-with-next and keep-together behaviour                                                                                                                                                                              | T1         | Specified |
| **STY-009** | A character style must declare how each mark in CNT-031 renders                                                                                                                                                                                                                                                                                                     | T1         | Specified |
| **STY-010** | That mapping must be per-theme, so that `strong` may render bold in one theme and as small capitals in a house style that says so                                                                                                                                                                                                                                   | T1         | Specified |
| **STY-011** | Alignment must be a property of a paragraph style and must not be offerable as a free per-block control (CNT-094)                                                                                                                                                                                                                                                   | Constraint | Specified |
| **STY-050** | The vertical space between two blocks must be the first block's space after plus the second block's space before, in every output format - never the larger of the two in one format and their sum in another                                                                                                                                                       | Constraint | Specified |
| **STY-051** | Line spacing must be declared as a minimum distance from baseline to baseline, and must mean that distance in every output format rather than a multiple each format interprets differently                                                                                                                                                                         | Constraint | Specified |
| **STY-054** | A line's extra space must sit above it, with its baseline one descender above the foot of its line, in every output format; a typeface must therefore carry the vertical metrics that place its baseline                                                                                                                                                            | Constraint | Specified |
| **STY-055** | Word output must render every run as the theme resolves it, setting a run's formatting directly wherever Word's own rules for combining styles would compute otherwise                                                                                                                                                                                              | Constraint | Specified |
| **STY-068** | The composition of styles must be canonical and stated once: a character style's properties compose over the paragraph style's, property by property, with the nearest declaration winning. The resolved value must be computed once and projected into each output format, never recomputed by the format's own rules (STY-055 is that rule's consequence in Word) | Constraint | Specified |
| **STY-069** | A theme's body text must meet a stated contrast minimum against its paper - 4.5:1, and 3:1 for large text - checked when the theme is saved rather than discovered in output, because the same colours are published to PDF and Word where nothing can adjust them (**PUB-030**, **CNT-078**, **STY-Q05**)                                                          | T1         | Specified |

**STY-050 and STY-051 exist because the same words mean different things in each target.** CSS and
Typst take the larger of two adjoining spaces; Word adds them. "Line spacing 1.15" multiplies the
font's natural height in Word, the font size in CSS, and adds a gap in Typst. A theme that says the
same number to all three gets three documents. Word's rule wins for spacing because Word is the one
target that cannot be reprogrammed, and the one a recipient restyles. See [themes.md](../../design/themes.md).

**STY-068 states a rule the document had only implied through its hardest case.** STY-055 overrides
Word's own combination rules, which presupposes a canonical answer for what a mark nested inside
styled content resolves to - and that answer was nowhere. Nearest declaration wins, resolved once,
projected three times.

**STY-069 is cheap insurance for a product whose point is legible documents.** Nothing in this
document or its neighbours required a theme's own colours to be readable: CNT-078 holds the editor to
WCAG and PUB-030 holds output to PDF/UA, and a theme with grey text on a grey ground satisfies both
by being an input rather than a surface. Checking at save is the only moment anything can be done
about it.

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

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **STY-015** | An image style must declare which dimension it fixes and at what value                                                                                                                                                                                                                                                                     | T1         | Specified |
| **STY-016** | Resolving an image style must derive the other dimension from the asset's intrinsic proportions, and must never distort an image                                                                                                                                                                                                           | Constraint | Specified |
| **STY-017** | An image style must declare a maximum in the dimension it does not fix; where that would be exceeded the image must be constrained by that dimension instead, still preserving proportion                                                                                                                                                  | T1         | Specified |
| **STY-018** | An image style must declare placement: inline with text, block, or floated, with alignment                                                                                                                                                                                                                                                 | T1         | Specified |
| **STY-019** | Resolving an image style must fail with a named error where the asset's intrinsic dimensions are not known (**AST** records them on ingest)                                                                                                                                                                                                | T1         | Specified |
| **STY-059** | Choosing a style from a catalogue must be understood as choosing from the theme's vocabulary rather than exercising free control: two image styles differing only in placement or alignment are two named choices an administrator made, and offering both must not be read as making alignment a per-block control (STY-011, **CNT-094**) | Constraint | Specified |

**STY-016 comes from having been burned by it.** Fixing both dimensions distorts the picture, and it
does so silently - nothing errors, nothing warns, and the first person to notice is a reader. Fixing
one and deriving the other is the only version that cannot go wrong quietly.

## 7. Admonition styles

STY-003 requires a catalogue of them and nothing said what one contains. Admonitions are the one
block kind whose appearance carries meaning - a warning that looks like a note has failed at the only
job it has - so the mapping from type to treatment belongs here, bound per theme exactly as the mark
mapping is (STY-010).

| ID          | Requirement                                                                                                                                                                             | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **STY-063** | An admonition style must declare, for each type in the vocabulary, its label, its icon where it has one, its border and background treatment, and the paragraph style its content takes | T2         | Specified |
| **STY-064** | The vocabulary of admonition types must be the catalogue's, and content must take it from there (**CNT-120**) rather than each declaring its own                                        | T2         | Specified |
| **STY-065** | An admonition whose type the theme's catalogue does not contain must fail the publish with a named error, on the same terms as any other missing style (STY-027)                        | Constraint | Specified |

**STY-064 is where this was previously ambiguous in two documents at once.** CNT-120 takes the
closed vocabulary from the admonition style catalogue; this says the catalogue is what holds it. One
list, in one place, and a theme that adds `regulatory` adds it for both.

## 8. Citation styles

| ID          | Requirement                                                                                                 | Tranche | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **STY-020** | A citation style must declare both the in-text form and the bibliography form                               | T6      | Specified |
| **STY-021** | The set must include at least CSE, Vancouver and Harvard (CNT-102)                                          | T6      | Specified |
| **STY-022** | A citation style must declare ordering, and how two sources that would render identically are disambiguated | T6      | Specified |
| **STY-023** | Adding a citation style must be possible without a code change                                              | T6      | Specified |

## 9. Themes

| ID          | Requirement                                                                                                                                                                                                                                  | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **STY-024** | A theme must bind one catalogue of each kind, and must be a versioned artifact                                                                                                                                                               | T1         | Specified |
| **STY-025** | A template must bind a theme (**TPL**), and a document must take the theme its template binds                                                                                                                                                | T1         | Specified |
| **STY-026** | Moving a document to a different theme must be an administrative act, never an authoring one, and must be audited                                                                                                                            | T2         | Specified |
| **STY-027** | Where a document references a style the theme does not contain, publishing must fail with a named error rather than substituting a default                                                                                                   | Constraint | Specified |
| **STY-028** | A baseline must pin the theme version it published under, so that re-publishing an approved document cannot change how it looks                                                                                                              | T3         | Specified |
| **STY-066** | A draft must resolve against the theme version its document is bound to. Publishing a new theme version must not change how a draft looks under its author; moving a document to a newer version must be a deliberate, audited act (STY-026) | Constraint | Specified |
| **STY-067** | Before a new theme version is adopted, which documents it would change must be listable - STY-034 one level up - so that a theme bump is a decision with a visible blast radius rather than a surprise across a tenant                       | T2         | Specified |
| **STY-072** | Adding a theme must be possible without a code change or a release, on the same terms as adding a style (STY-029) or a citation style (STY-023)                                                                                              | T2         | Specified |

**STY-066 and STY-067 cover the seam most likely to bite.** A baseline pins its theme version
(STY-028) and a draft pinned nothing, so a tenant publishing theme v4 could have re-rendered every
draft in the tenant under its authors. Drafts follow the version they are bound to, moving is
deliberate, and what a bump would change is visible before somebody makes it.

**STY-027 is the same rule this repository already learned about icons.** A missing asset that
silently substitutes a default produces output that is wrong and looks deliberate, and nobody finds
it until a reader does. Failing loudly is the only behaviour that surfaces the problem while
somebody can still fix it.

**STY-028 matters more than it sounds.** Without it, approving a document approves how it looked on
one day, and a theme change months later re-renders something that was signed.

## 10. Extension and administration

| ID          | Requirement                                                                                                                     | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **STY-029** | An administrator must be able to add a style to a catalogue without a code change or a release                                  | T2      | Specified |
| **STY-030** | A style added that way must immediately be selectable by authors and honoured by every output format                            | T2      | Specified |
| **STY-031** | A style must not be deletable while anything references it, and its uses must be listable                                       | T2      | Specified |
| **STY-032** | Adding, changing and deleting a style must be audited, including what changed                                                   | T2      | Specified |
| **STY-033** | A tenant must be able to restrict which styles authors may choose, so that a catalogue can hold more than a house style permits | T2      | Specified |
| **STY-034** | Changing a style must show what it will affect before the change is made                                                        | T2      | Specified |

## 11. Resolution

| ID          | Requirement                                                                                                                                                                                                                                                                                                                    | Tranche    | Status                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------- |
| **STY-035** | The editor and the publisher must resolve the same style from the same catalogue, by the same rules                                                                                                                                                                                                                            | Constraint | Specified             |
| **STY-036** | The editor must render typefaces, sizes, colours and spacing as the theme declares (CNT-082, CNT-097)                                                                                                                                                                                                                          | T1         | Superseded by STY-058 |
| **STY-037** | Where the editor cannot reproduce an effect because it depends on pagination, it must not approximate it silently; preview is what shows it (CNT-095)                                                                                                                                                                          | T1         | Specified             |
| **STY-038** | Style resolution must be deterministic: the same content, style and theme version must always produce the same appearance                                                                                                                                                                                                      | Constraint | Specified             |
| **STY-053** | Every style property must be verified, by an automated suite, to render the same measured value in each output format that renders it - in the editor, in PDF and in Word                                                                                                                                                      | T1         | Specified             |
| **STY-058** | The editor must render every declared property of every paragraph and character style as the theme declares it, not a sample of them, so that STY-053's suite tests nothing STY-036 did not oblige (CNT-082, CNT-097)                                                                                                          | T1         | Specified             |
| **STY-060** | The conformance suite (STY-053) must carry an explicit list of approved cross-format deviations - the Word typeface substitution in STY-052 is the only one today - and a deviation not on that list must fail. Determinism (STY-038) is a claim about one format given one input, never that every format renders identically | Constraint | Specified             |
| **STY-070** | Where a style or a glyph will not resolve, the editor must render an explicit unresolvable marker rather than a silent default, so that the failure appears while somebody can still fix it (STY-027 and STY-049 are the publish behaviours)                                                                                   | T1         | Specified             |

**STY-060 resolves a tension between three requirements that are each correct.** STY-038 says the
same inputs always produce the same appearance; STY-053 says every property renders the same measured
value in every format; STY-052 mandates a substitution in Word where a licence forbids embedding.
Without a list of sanctioned deviations the suite either fails on exactly the faces STY-052 exists to
serve, or quietly excuses whatever it happens to find.

**STY-070 completes the fail-loud philosophy at the end where somebody can act.** Publishing refuses
a missing style (STY-027) or a missing glyph (STY-049); until now the editor could have shown a
default and said nothing, which is the silent substitution both of those exist to prevent, arriving a
day earlier.

## 12. Typefaces

| ID          | Requirement                                                                                                                                                                                                                                                              | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **STY-039** | A theme must declare the typefaces it uses, and each must be available in a browser, in the desktop shell, and in the publishing pipeline                                                                                                                                | T1         | Specified |
| **STY-040** | A typeface that cannot be loaded must fail the publish, and must never be substituted silently                                                                                                                                                                           | Constraint | Specified |
| **STY-041** | A theme must record the licence under which each typeface is held, and whether that licence permits embedding it in published output                                                                                                                                     | T1         | Specified |
| **STY-042** | Publishing must refuse to embed a typeface whose licence does not permit it, and must say so rather than quietly substituting                                                                                                                                            | T1         | Specified |
| **STY-045** | Typefaces supplied with the product must be open-licence, on terms that permit embedding in published output and redistribution with the software                                                                                                                        | Constraint | Specified |
| **STY-046** | A tenant must be able to supply its own typefaces, asserting the licence it holds them under, and the product must not redistribute an uploaded face beyond the tenant that supplied it                                                                                  | T2         | Specified |
| **STY-047** | A typeface must be a versioned artifact, and a baseline must pin the exact files it published with rather than the theme version that named them                                                                                                                         | Constraint | Specified |
| **STY-048** | The default theme must cover the scripts the supported locales admit (**LOC-038**), the bidirectional text CNT-059 admits, and the mathematics CNT requires, because a face that cannot set them makes those requirements undeliverable                                  | T1         | Specified |
| **STY-049** | Publishing must fail where any character in the document has no glyph in the theme's typefaces, rather than borrowing one from a face the theme never declared or setting an empty box                                                                                   | Constraint | Specified |
| **STY-052** | A typeface whose licence does not permit embedding in Word must declare a permitted face for Word output, and every publication using it must report the substitution                                                                                                    | T1         | Specified |
| **STY-062** | A typeface must be validated on ingest for the vertical metrics STY-054 depends on - ascent, descent and line gap - product faces when the product is built and tenant faces when they are supplied (STY-046). A face without them must be refused rather than tolerated | Constraint | Specified |

**Section 12 was the open font question from the architecture work, and it is now settled.** The
constraint that made it hard has not changed: one typographic system has to work in a browser tab,
in an Electron window loading over `file://`, and in whatever renders the PDF. What settles it is
that embedding a typeface in a published document is a licensed act, and a product that embeds
without checking has made its customers' licensing problem into its own. STY-045 keeps the
product's own faces open-licence; STY-046 leaves a customer's brand face where its licence already
sits, with the customer. See [ADR-0010](../../decisions/0010-open-licence-typefaces-only.md).

**STY-047 closes a hole that only became visible once that was answered.** STY-028 pins a theme
version in a baseline, and PUB-046 requires re-publishing that baseline years later to produce the
same document. Those two are compatible only if the files themselves are pinned - a theme version
naming a typeface that has since been revised, or withdrawn, re-renders differently and says
nothing. It is the failure mode this specification keeps meeting: not an error, an absence nobody
notices.

**STY-049 is here because no engine catches it.** STY-040 covers a typeface that cannot be
loaded. The publishing engine spike found the neighbouring case, a face that loads and lacks the
characters it is asked to set, and found that Typst either borrows the glyphs silently from a face
nobody declared or, with only pinned fonts, sets empty boxes - exit code 0 and no warning either way.
The check has to be the pipeline's own. See
[ADR-0013](../../decisions/0013-typst-rendering-resolved-data-through-a-fixed-template.md).

## 13. Interchange

| ID          | Requirement                                                                                                                                                                                                                    | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | --------- |
| **STY-043** | A catalogue must be exportable and importable, so that a house style can move between spaces and tenants                                                                                                                       | T2      | Specified |
| **STY-044** | An import must report anything it could not represent rather than dropping it                                                                                                                                                  | T2      | Specified |
| **STY-071** | An import must validate that every typeface, catalogue and style the imported catalogue references exists in the destination, and must report what does not at import time rather than leaving it to fail at publish (STY-027) | T2      | Specified |
| **STY-073** | An exported catalogue must re-import into an equivalent catalogue, and that round trip must be covered by a test rather than asserted                                                                                          | T2      | Specified |

## 14. Non-requirements

| ID          | Not this                                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **STY-N01** | **No per-document and no per-author overrides.** A document that needs a different look uses a different theme (CNT-N08)                                                                                           |
| **STY-N02** | **No page geometry.** Size, margins, running heads and columns belong to the publishing layout                                                                                                                     |
| **STY-N03** | **No stylesheet or code supplied by a tenant.** Extension is declarative, from a fixed set of properties. Arbitrary style code would be an injection surface and would make every output format a rendering engine |
| **STY-N04** | **Not a design tool.** A theme is configured, not drawn                                                                                                                                                            |
| **STY-N05** | **No inverting content in dark mode.** The application's chrome may go dark; the document canvas stays the theme's paper and ink, because a theme's colours were chosen for paper                                  |

## 15. Open questions

| ID          | Question                                                                                                                                                                      | What would settle it                                                                                                                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **STY-Q01** | **Are catalogues tenant-wide, or per space?** A consultancy working for two clients may need two house styles that authors must not confuse                                   | Whether early customers serve more than one end client from one tenant. Likely yes in this market                                                                                                                                      |
| **STY-Q02** | **Does STY-N03 survive a real house style?** Declarative properties cover most of typography and none of the last five per cent somebody's brand guideline insists on         | The first house style that cannot be expressed. The answer is probably to widen the declared property set rather than open an escape hatch                                                                                             |
| **STY-Q03** | **Who supplies typefaces, and who holds the licence?**                                                                                                                        | **Settled.** Product-supplied faces are open-licence only; a customer's brand face is supplied by the customer under the customer's own licence. See [ADR-0010](../../decisions/0010-open-licence-typefaces-only.md)                   |
| **STY-Q04** | **Does a theme need variants - screen against print, light against dark?**                                                                                                    | **Settled for the editor.** No: the canvas stays paper when the application goes dark (STY-N05). Whether the HTML reading format needs a screen palette is left to its design. See [themes.md](../../design/themes.md)                 |
| **STY-Q05** | **What contrast ratio binds a customer's own brand palette (STY-069)?** A house style whose colours fail 4.5:1 is a real thing, and refusing it outright refuses the customer | Legal and commercial advice with the first brand that fails. The likely answer is that the product's own themes must pass while a tenant's are warned rather than refused, which is a different requirement from the one written today |

## 16. Traceability

| This document      | Rests on                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Section 3          | Scope §7.18                                                                                                                               |
| STY-010, STY-011   | CNT-031, CNT-035, CNT-094 - the closed mark set and named styles                                                                          |
| STY-015 to STY-019 | CNT-121, CNT-122, CNT-123 - an image reference carries a named style and no absolute dimension; asset dimensions from §7.20 (**CNT-Q15**) |
| STY-027, STY-040   | Scope §11 and this repository's own icon rule: never substitute in silence                                                                |
| Section 12         | The open typography question carried from the architecture work                                                                           |
| STY-N01            | CNT-N08, no per-document override                                                                                                         |
| STY-050 to STY-055 | The publishing engine and Word spikes; ADR-0013 and ADR-0015 - which is why their numbers sit below their topic                           |
| Section 7          | CNT-120 - the admonition vocabulary content takes from here                                                                               |
| STY-069            | PUB-030, CNT-078 - accessibility of output and of the editor                                                                              |
| STY-061            | API-005 - a stable machine-readable code beside the message                                                                               |
| STY-056 to STY-073 | [The v1 review](<../../reviews/STY - Styles and presentation themes.md>); section 17                                                      |

## 17. Change history

One row per change, against
[the review](<../../reviews/STY - Styles and presentation themes.md>) that prompted it. The rules for
what gets a new identifier are in [the index](README.md#how-a-requirement-is-written).

### Issues in the requirements themselves

| Point                                  | Change                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STY-007 mixes modalities               | **Superseded by STY-056** as a `must`, with **STY-057** saying what resolution does with a chain and making the resolved set inspectable. As written an implementer could have dropped inheritance and failed nothing, while STY-035 asked the editor and the publisher to agree on rules that might not exist |
| STY-036 enumerates illustratively      | **Superseded by STY-058**: every declared property, not a sample - otherwise STY-053's suite tests more than STY-036 obliged                                                                                                                                                                                   |
| STY-018 against STY-011 and CNT-094    | **STY-059** states the interpretation: choosing a style is choosing from the theme's vocabulary. Two image styles differing only in alignment are two administrator-made choices, not a per-block control                                                                                                      |
| STY-052 against STY-038 and STY-053    | **STY-060.** The suite carries an explicit list of approved deviations, the Word substitution is the only one today, and determinism is a claim about one format given one input                                                                                                                               |
| "Named error" is never machine-stable  | **STY-061**: a stable identifier beside the human message, so a failure can be asserted in a test and cited in support (API-005)                                                                                                                                                                               |
| STY-054 depends on unvalidated metrics | **STY-062**: ascent, descent and line gap validated on ingest, and a face without them refused. Open-licence faces are exactly where they are often missing                                                                                                                                                    |

### Missing areas

| Gap                                    | Change                                                                                                                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Admonition styles have no substance    | **A new section 7: STY-063 to STY-065.** It was a dropped section rather than a delegation - STY-003 required the catalogue and nothing said what one contains. The vocabulary lives here, CNT-120 takes it from here, and the two documents now point at one list |
| Live drafts against theme versions     | **STY-066** and **STY-067**. A baseline pinned its theme and a draft pinned nothing, so a theme bump could have re-rendered every draft in a tenant under its authors                                                                                              |
| Composition of conflicting styles      | **STY-068**: nearest declaration wins, property by property, resolved once and projected into each format. STY-055 overrides Word's own combination rules, which presupposed a canonical answer that was never stated                                              |
| Accessibility of themes                | **STY-069**, checked when the theme is saved because a published PDF has nothing left that can adjust it. **STY-Q05** asks what binds a customer's own palette                                                                                                     |
| Authoring-time unresolvable references | **STY-070**: an explicit marker in the editor, never a silent default - the same rule as STY-027 and STY-049, a day earlier                                                                                                                                        |
| Import referential integrity           | **STY-071**: unresolvable typefaces, catalogues and styles reported at import rather than left to fail at publish                                                                                                                                                  |

### Smaller items, and the seams the review asked to verify

| Item                                  | Finding                                                                                                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retention of pinned typeface files    | **Confirmed: VER-022** keeps everything a baseline pins retrievable for as long as the baseline exists, and STY-047 pins the files themselves. A years-old baseline can still re-publish |
| Adding a theme without a code change  | **STY-072** states for themes what STY-029 and STY-023 state for styles and citation styles                                                                                              |
| Export round trip                     | **STY-073**: an exported catalogue re-imports into an equivalent one, tested rather than implied                                                                                         |
| Where admonition treatment lives      | **Here, and it did not.** CNT-120 points at this catalogue and nothing in the other twenty described it                                                                                  |
| Who owns composition semantics        | **This document.** CNT declares the marks and STY-009 maps them; how a mark composes over a paragraph style is appearance (STY-068)                                                      |
| Whether anything covers accessibility | **CNT-078 for the editor, PUB-030 to PUB-036 for output, TAB-031 for tables** - and none of them reached a theme's own palette, which is why STY-069 exists                              |
| Provenance of STY-050 to STY-055      | A traceability row links them to the publishing engine and Word spikes, which is what makes the numbering's placement self-explanatory                                                   |

### Counts

|                  | Before | After                     |
| ---------------- | ------ | ------------------------- |
| Requirements     | 55     | 73, of which 2 superseded |
| Non-requirements | 5      | 5                         |
| Open questions   | 4      | 5                         |

### From the cross-cutting review

A later review read all twenty-one documents against each other. Its sections are answered in
[XXX - Response.md](<../../reviews/XXX - Response.md>); what changed here:

| Review sections     | Change                                                                                                                                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1.8, 3.1.9, 3.2.6 | The image-style traceability row now cites CNT-121 to CNT-123 rather than a typo and two requirements since superseded into this area. **STY-048** cites the supported locales and CNT-059's bidirectional text rather than LOC-004, which is about interface layout |
