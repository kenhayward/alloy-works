# The Word check, 0.135.0

- **Who:** Ken
- **When:** 2026-10-05, started 13:25 UTC
- **Commit:** `04d45c8326199506f84d205995afba2b47af09b5`, from a clean tree
- **Word:** Microsoft Word 16.0, build 20439, on Windows 11
- **How:** the whole worker suite with `ALLOY_WORD_CHECK=1`, reduced by
  `pnpm trace record-run 0.135.0 word` to [`word.json`](word.json)

## What Word showed

341 of 341 tests passed, none skipped. The 27 under PUB-029 opened each fixture in Word itself and read
back what Word shows: every fixture opened without an error, and Word's own headings, lists, fields,
contents, captions, footnotes, cross-references, equations, fonts, page numbers and running heads
matched the numbering table and the PDF, unchanged by saving again.
