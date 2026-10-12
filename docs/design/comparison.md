# Comparison

What changed between two versions of a component, two baselines of a document, or an author's
session and the version it opened from: at three levels (VER-024), each change saying how it was
matched (VER-029), rendered as a redline (VER-030). [ADR-0058](../decisions/0058-suggestions-are-proposals-beside-the-content.md)
makes its result the ground suggestions stand on, so it is designed as **anchored changes** first and
a rendering second.

> **Built** by [the CP plan](../plans/2026-10-11-cp-comparison.md), T3's fourth phase. It
> replaces the content model spike's `content/compare.ts`, keeping its tokenizer and threshold.

## The shape in one paragraph

Two content documents are compared unit by unit, at every depth. **A unit is a block, or a container
a block sits in**: a list item, keyed by the identifier of the first block it holds; a table cell,
keyed by its row and column; a footnote's content, keyed by the footnote. **Blocks are matched by
identifier**, and those left over by **word-token similarity** - the spike's Dice over lower-cased
words, at least 0.4 (VER's open question Q05) - each match recording which. Among matched units under
one parent the **longest run kept in order stands still**; any other matched unit **moved**. A matched
block whose text differs is **edited**, its text compared word by word; one whose attributes differ
says which. A block that kept its identifier and lost its end, where a new block begins with that
end, was **split**; one whose text was taken into the block before it was **joined**. What matched
nothing was **inserted** after an anchor or **deleted**. So a paragraph moved and reworded is one
change (VER-027). A document compares its outline the same way, and each component at the two versions
its sides resolve to; **resolved output** compares what a publish would print, naming why each
difference arose (VER-031, VER-045).

## Requirements owned

| ID          | How                                                                                                                                                                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VER-024** | `compareContent` (content), `compareOutlines` (structure) and `compareResolved` (resolved output), in `packages/domain`                                                                                                                             |
| **VER-025** | Any two versions of a component (`GET /v1/components/{id}/comparison?from&to`); any two baselines of a document, or a baseline and the document as it resolves now (`GET /v1/baselines/{id}/comparison?with`)                                       |
| **VER-027** | Matching precedes ordering: a unit matched in both is one change, `moved` and `edited` together where both hold                                                                                                                                     |
| **VER-028** | Identifier first; then, among blocks of one type left over, the highest Dice at or above 0.4, greedily, best first                                                                                                                                  |
| **VER-029** | Every change carries `matched: 'identity' \| 'similarity'`, and the redline draws a similarity match apart                                                                                                                                          |
| **VER-030** | The redline drawn over the newer side in the page, and exported as one self-contained HTML file **(default)**                                                                                                                                       |
| **VER-031** | `compareResolved` names, per node, each cause that holds: a component version, a dataset version, a definition version, the layout's or theme's version. Conditions are T4's: the identity until then, so never a cause yet                         |
| **VER-045** | The same for two baselines under different template versions: a definition cause told from an edit, field by field                                                                                                                                  |
| **VER-050** | Every route reads as its caller. A component they may not read is its node alone: where it stands, never whether it changed; in the page and the export                                                                                             |
| **VER-051** | Content and structure: two baselines of 300 components, 20 blocks each, and a component with 300 versions listed and compared, held to counted operations in CI and timed in the service **(default, provisional)**; resolved output budgeted apart |
| **CNT-111** | The editor's **Compare** lists the component's versions, who cut each and when, and draws the redline against the one chosen                                                                                                                        |
| **CNT-112** | Any two versions; revisions when LIF designates them, as `revision.version` already names them                                                                                                                                                      |
| **CNT-113** | **My changes**: the editor compares the version it opened from with what it holds now, in the browser, so it needs no lock and lags no save                                                                                                         |
| **COL-026** | The same view is the author's own changes, told apart from others' suggestions when phase 6 draws them                                                                                                                                              |
| **SCH-025** | `GET /v1/changes?since=` for a document (its outline, the components it places and its values accepted), a space, or a listing's results by `listing.ts`, as the caller may read them                                                               |
| **SCH-048** | Versions are never deleted (VER-036), so the record begins where the artifact did, or where the environment was made; a `since` before it answers from there and says so                                                                            |

## Anchored changes

The result is a list, in the newer side's reading order, of:

| Change      | Carries                                                                    |
| ----------- | -------------------------------------------------------------------------- |
| `unchanged` | Both keys, so a redline can stand still                                    |
| `inserted`  | The new unit, and the unit it stands after (its parent's start otherwise)  |
| `deleted`   | The old unit, and where it stood                                           |
| `moved`     | Both, and the unit it now stands after                                     |
| `edited`    | Both, and the word-level operations over its text: kept, inserted, deleted |
| `changed`   | Both, and which attributes differ: style, kind, a table's shape, marks     |
| `split`     | The block and the new one its end became                                   |
| `joined`    | The block and the one taken into it                                        |

A unit may be `moved`, `edited` and `changed` at once: one record, several facets. An inline node that
is not text is one token: a footnote equal by its identifier, its content compared under it; any other
equal by its canonical form.

## What it does not do

- **Formatting within a run** reports as `changed: marks` on the block, not per word.
- **Pages**: resolved output is compared as text and causes, not as PDF bytes; two publications'
  outputs are compared by their digests.
- **Conditions** as a cause, until T4 sets one.
