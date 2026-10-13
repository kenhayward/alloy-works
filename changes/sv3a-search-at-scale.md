### Fixed

- **Search is fast on a large tenant.** Words are found through their index, and the definitions a search reads through theirs, so a search no longer reads everything its reader may see (#602).

### Changed

- **Past 1,000 matches, search shows the best matches among the 1,000 changed most recently**, and says so.
- **Facets past 1,000 matches count the most recently changed matches alone**: the 1,000 newest with every filter, and the 1,000 newest failing one. Each count then says at least, even a small one, and `facetsBounded` in `GET /v1/search` says so.
- **A term under three characters is part of a word only beside a longer term**; alone, it is looked for as a whole word.
