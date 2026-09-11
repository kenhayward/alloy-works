# Word probe

> **Throwaway.** One small Word document that exercises the two mechanics
> [ADR-0015](../../docs/decisions/0015-word-output-our-own-writer-reflowable.md) decided without
> anyone having seen them in Word. The result is recorded in
> [`word-output.md`](../../docs/design/word-output.md#verification); the writer itself will be built
> in `packages/domain`, not from this script.

| Mechanic                      | What the document contains                                                                                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fields refreshed on opening   | A contents field, a list of figures, and "it is Figure N, on page P" references to a figure several pages on, with `settings.xml` asking Word to update fields                                                   |
| Equations from the maths tree | Inline and display equations built from the publishing spike's structural tree: a sum, an integral and a limit that must contain their operand, a fraction, a root, stretchy brackets, and two ways of numbering |

Not part of the pnpm workspace, not run by CI. It reuses the publishing spike's image, which has
`latex2mathml`, and imports that spike's maths tree rather than copying it:

```bash
docker run --rm -v "$(pwd)/spikes:/spikes" -w /spikes/word-probe alloy-publishing-spike python3 probe.py
```

The document is written to `out/word-probe.docx`, which is ignored. Open it in Word to check it;
LibreOffice renders it too, but differently, and the design records where.
