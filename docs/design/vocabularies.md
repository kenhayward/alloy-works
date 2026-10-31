# Vocabularies

Named lists of permitted values that metadata fields and condition axes draw on, kept by hand or from
a source: T7's first slice. Ken's answers of 2026-10-31 shaped it, and
[the VO plan](../plans/2026-10-31-vo-vocabularies.md) builds it.

## The shape in one paragraph

A **vocabulary** is a definition of the environment's, kind `vocabulary`, beside fields and condition
axes and versioned as they are: a key, a name, a base language, an order (declared, or by label in
the reader's collation) and up to 5,000 values. A value has an id allocated once in an axis key's
form, a label per language, an optional description per language, and a state: active, deprecated
naming its replacement, or retired. **A version never drops a value**, so retiring is the only way
out and anything already holding a value still reads it. A `text` field's validation may name a
vocabulary, and an axis may take its values from one: an author is offered active and deprecated
values in the vocabulary's order, warned of a deprecated one, never offered a retired one. A value is
checked at save against the values held in the environment, never against a source; publishing lists
deprecated and retired values held and refuses none. A vocabulary moves as SKOS, and may take its
values from a query definition or a SKOS address, refreshed on demand.

## Requirements owned

| ID          | How it is met                                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **LIB-020** | `vocabulary`, a definition: a key, a name and values, each with an id allocated once and a label                                          |
| **LIB-065** | Environment-wide, made and changed with `manage_definitions`, read by anyone signed in through `/v1/vocabularies`                         |
| **LIB-024** | A label per language, the base language's where a language has none                                                                       |
| **LIB-053** | `order`: declared, or by label in the reader's collation with ties by id                                                                  |
| **LIB-054** | A description per language, shown beside the value where it is chosen                                                                     |
| **LIB-055** | `deprecated` names its replacement, another value, never a loop; `retired` is no longer offered                                           |
| **LIB-023** | A version keeps every id; a retired value stays valid where held and is flagged there                                                     |
| **LIB-063** | Choosing a deprecated value says so at once, with its replacement; a retired one is never offered                                         |
| **LIB-022** | An axis declares its values or a vocabulary; its value keys are the vocabulary's ids                                                      |
| **MET-003** | A `text` field's validation names a vocabulary, so MET-002's closed set of data types stands                                              |
| **MET-032** | Checked at save against the values held, never the source                                                                                 |
| **LIB-058** | A source: a query definition run through the connector, or a SKOS address the connector fetches; each value keeps its source's identifier |
| **LIB-061** | SKOS JSON-LD out, JSON-LD and Turtle in, in a documented form                                                                             |
| **IMP-051** | As LIB-061                                                                                                                                |
| **LIB-005** | Where used: the fields and axes naming it, and per value the components holding it                                                        |
| **LIB-004** | A publish records the vocabulary versions it printed labels from, and a baseline pins them                                                |

LIB-030 (a library shared between spaces) and LIB-043 (labels colliding across spaces) wait for the
sharing slice.

## Where a value is checked

`checkVocabularyValues`, beside MET-038's `checkUserValues`, is the one check: called when a
component's values are saved, with the values its previous version held, it refuses an id the
vocabulary does not hold and a retired id the previous version did not hold. It is not part of
`validate`, so publishing, promotion, restore and suggestions, which keep only `fixed` failures, never
refuse a held value.

## SKOS

A vocabulary is one `skos:ConceptScheme`, `urn:alloy-works:vocabulary:<key>`, its `skos:notation` the
key and its `skos:prefLabel` the name in the base language; each value a `skos:Concept`,
`urn:alloy-works:vocabulary:<key>:<id>`, its notation the id, a `prefLabel` and a `skos:definition`
per language. Identities are by key, so an export imports into any environment. The Alloy Works
namespace `aw:` is `urn:alloy-works:skos:`: the scheme's `aw:order` (`declared` or `label`), each
concept's `aw:position` (Turtle is unordered), and `aw:retired`. A deprecated value is
`owl:deprecated` with `dct:isReplacedBy`; a retired one `owl:deprecated` and `aw:retired`, so a reader
knowing only SKOS sees it withdrawn. An import creates the vocabulary by its key or records its next
version, never removing a value: one held but absent is kept, listed in `kept`. What it cannot hold
(a concept with no notation or one not in key form, a label beyond the limits, a replacement outside
the file, any other property) is listed in `notRepresented`.

Anybody signed in reads vocabularies but somebody from outside who reads only what was shared with
them, who chooses no values (as the people picker, R17-I).
