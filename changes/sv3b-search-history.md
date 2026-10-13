### Changed

- **Searching every version is bounded as searching the latest is**: past 1,000 matches, its results, counts and facets come from the 1,000 changed most recently.
- **Every version matches a place by its words across all its versions together**: two words held by two versions find it, and an excluded word excludes a place any version held it in. A phrase only an earlier version held is not found once one of its words is back in the newest version.
- **Filters and facets over every version read each place's newest values.**
