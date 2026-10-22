# CSL styles and locales

Data, never code: passed to the `citations` module as strings by `files.ts`, which
`pnpm --filter @alloy-works/domain generate` writes from these files. Each was fetched on 2026-10-22,
checked as CSL XML of its kind (a `style` with `citation` and `bibliography`, or a `locale`) and copied
in unmodified.

| File                                                 | From                                                                                                   | Seeded as | Licence      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------- | ------------ |
| `styles/harvard-cite-them-right.csl`                 | [citation-style-language/styles](https://github.com/citation-style-language/styles) at `420698a0`      | Harvard   | CC BY-SA 3.0 |
| `styles/nlm-citation-sequence.csl`                   | the same; the independent parent of `dependent/vancouver-nlm.csl` (no `vancouver.csl` is held now)     | Vancouver | CC BY-SA 3.0 |
| `styles/cse-name-year.csl`                           | the same; CSE 9th edition, name-year (the repository no longer holds `council-of-science-editors.csl`) | CSE       | CC BY-SA 3.0 |
| `locales/locales-*.xml` (en-US, en-GB, de-DE, fr-FR) | [citation-style-language/locales](https://github.com/citation-style-language/locales) at `8bef426f`    | -         | CC BY-SA 3.0 |

Each file's own `<rights>` element states its licence
([CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)), and its `<info>` its authors; both
are kept as they arrived. The processor, citeproc-js, is CPAL-1.0 (ADR-0067).
