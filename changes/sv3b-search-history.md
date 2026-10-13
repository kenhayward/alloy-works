### Changed

- **Searching every version is as fast as searching the latest**, and its results, counts and facets are bounded the same way: past 1,000 matches, the best of the 1,000 changed most recently.
- **Every version matches a place by its words across all its versions together**: two words held by two versions find it, and an excluded word excludes a place any version held it in. A phrase only an earlier version held is not found once one of its words is back in the newest version.
- **Filters and facets over every version read each place's current values**, so a value only an earlier version held finds nothing.
