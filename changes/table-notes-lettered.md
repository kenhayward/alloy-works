### Added

- **Notes on a bound table.** A bound table placed through the API can hold notes on a column, or on a cell found by its row's key values, so a note follows its row however the rows are sorted. Each prints beneath the table, lettered, in the PDF and Word. A note on a row the result no longer has, or a keyed note on a query definition with no key, fails the publish by name.

### Changed

- **Table footnotes are lettered beneath their table.** A footnote in any table's cell, its header rows included, is now printed as a letter in the cell and a note beneath the table - a, b, c in reading order - rather than at the foot of the page. Later document footnotes are renumbered without them, and a cross-reference to one prints its table and letter, such as "Table 3 (a)". A table's own note now begins with the layout's word for a note, "Note:". Publications already made keep their numbers.
