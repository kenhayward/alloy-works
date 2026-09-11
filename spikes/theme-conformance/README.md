# Theme conformance - harness

> **Throwaway harness, real subject.** This measures the theme prototype in
> `packages/domain/src/theme/` against [`docs/design/themes.md`](../../docs/design/themes.md). The
> resolver and projections are product code, written test-first; this directory is how their
> outputs are compared, and is the seed of the conformance suite STY-053 requires. It is outside
> the pnpm workspace and outside CI, because it needs Chromium, Typst and LibreOffice.

## What it measures

One fixture document (`fixture-document.json`) through the example theme, rendered three ways:

| Target | Renderer                                      | Stands for                                        |
| ------ | --------------------------------------------- | ------------------------------------------------- |
| editor | Chromium, with the CSS projection             | The editor                                        |
| pdf    | Typst, `template.typ` reading `theme.json`    | Published PDF (ADR-0013)                          |
| word   | LibreOffice, `styles.xml` plus `wordRun` runs | Word - **a proxy**; Word itself is checked by eye |

For every line: the baseline, relative to the first line's, and the start, relative to the body's
left edge. For every token and marked word: size, weight, posture and colour, against what the
resolved theme says. Positions in a PDF come from each character's text matrix, which is where the
baseline really is, not from its bounding box. Tolerance is half a point.

The fixture is built so each of the design's riskiest claims is a number: a forced line break
(line spacing, independent of line breaking), body followed by a quote (6pt after plus 12pt
before), a heading followed by body (different line spacings - where the extra space goes), a
`strong` word in a bold heading (Word's toggle), and a word both strong and emphasised (Word's one
character style per run).

## Running it

From the repository root:

```bash
pnpm --filter @alloy-works/domain build
```

```bash
node spikes/theme-conformance/emit.mjs
```

```bash
docker build -t alloy-theme-conformance spikes/theme-conformance
```

```bash
docker run --rm -v "$(pwd)/spikes/theme-conformance:/spike" alloy-theme-conformance sh /spike/run.sh
```

On Windows under Git Bash, prefix the `docker run` with `MSYS_NO_PATHCONV=1` and use `$(pwd -W)`.
The report is `out/report.json`; `out/word.docx` is the file to open in Word.
