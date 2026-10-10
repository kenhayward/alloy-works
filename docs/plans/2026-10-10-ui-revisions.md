# UI revisions after the table formatting

Ken's list of 10 October 2026 and the outline panel handoff
([docs/interface/handoffs/outline-panel/](../interface/handoffs/outline-panel/README.md)), agreed
as six PRs. Only UI6 crosses a stored shape, so only it is planned here; the rest are UI alone.

| PR  | What                                                                                |
| --- | ----------------------------------------------------------------------------------- |
| UI1 | The component page's panes sized and hidden as the document page's; its tabs pinned |
| UI2 | The toolbar's second line: Paragraph style and a list's own options; ADR-0053       |
| UI3 | The other option bars on the second line                                            |
| UI4 | The Part tab in labelled rows; ADR-0054                                             |
| UI5 | The Data tab in two-line rows by part                                               |
| UI6 | Search finds a part of a word, in any case                                          |

## UI6: a part of a word

Search was full-text alone: whole words, stemmed, already case-insensitive, so `dexa` found
nothing. Agreed with Ken: keep the words, and add a part of a word beside them, so phrases,
exclusion, scopes (SCH-011) and ranking stand.

- **Query** (`parseQuery`): `contains`, the free terms wanted and excluded; null beside an `or` or
  where every term is scoped.
- **Match** (`searchWords`): `words or (every wanted ilike '%term%' and no excluded ilike)` over
  `search_entry.body`, a typed `%`, `_` or `\` escaped. Ranking unchanged, so a part-only match
  ranks last.
- **Index**: tenant migration 0062, `gin (body extensions.gin_trgm_ops)`. `pg_trgm` is created by
  `prepareDatabase` in `extensions`, as pgvector is: the migrator may not create an extension.
  `dev:setup` runs it before migrating, so an existing stack takes it on its next `up`.
- **Risk**: `body` is every place's words, so a part can match across two places' words joined by
  a space; accepted, as the words already match across places.
