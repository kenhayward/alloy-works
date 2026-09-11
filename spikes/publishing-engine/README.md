# Publishing engine spike - harness

> **Throwaway, except the cases.** This is the harness for
> [`Publishing_Engine_Spike.md`](../../docs/specification/Publishing_Engine_Spike.md). The findings
> are in [`Publishing_Engine_Spike_Findings.md`](../../docs/specification/Publishing_Engine_Spike_Findings.md).
> The brief keeps the case set as a regression suite for whichever engine wins; everything else here
> is scaffolding to reach a decision and should not be built on.

Not part of the pnpm workspace, not run by CI, and deliberately so: it needs four PDF engines and a
Java validator that no CI job should have to install.

## What is here

| File             | Does                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------- |
| `Dockerfile`     | One Linux image holding WeasyPrint, PagedJS, Chromium and Typst; builds for arm64 too |
| `cases.py`       | The gate cases (1 to 4), each described once and emitted as both XHTML and Typst      |
| `cases_more.py`  | Cases 5 to 8: equations, page furniture, typefaces, the long document                 |
| `typst_data.py`  | The shape ADR-0013 chose: the resolved document as JSON, equations as a tree          |
| `template.typ`   | The one fixed Typst template that reads that JSON. Nothing in it evaluates content    |
| `mathsvg.mjs`    | LaTeX to SVG with MathJax, for WeasyPrint, which has no mathematics of its own        |
| `render.py`      | Renders the gates with every engine; times the preview case                           |
| `run_more.py`    | Renders cases 5 to 8 for the finalists, and the gates again in the data shape         |
| `browser.mjs`    | Drives Chromium, with or without PagedJS, for the two browser candidates              |
| `checks.py`      | Judges the gates from each PDF's text positions and structure tree                    |
| `checks_more.py` | Judges cases 5 to 8, and the gates in the data shape                                  |
| `det.py`         | Case 9: renders on one architecture, then compares across both                        |
| `experiments.py` | Follow-ups that price a gate failure: the smallest change that might close it         |

veraPDF runs from its official image, `verapdf/cli`, rather than being installed in ours.

## Running it

From this directory, with Docker running a Linux engine:

```bash
docker build -t alloy-publishing-spike .
```

```bash
docker run --rm -v "$(pwd):/spike" alloy-publishing-spike python3 render.py
```

```bash
for f in out/pdf/case[123]-*.pdf; do b=$(basename "$f" .pdf); docker run --rm -v "$(pwd)/out/pdf:/data" verapdf/cli --flavour ua1 --format json "/data/$b.pdf" > "out/verapdf/$b.json"; done
```

```bash
docker run --rm -v "$(pwd):/spike" alloy-publishing-spike python3 checks.py
```

Cases 5 to 8, and the gates in the data shape, after the gate run above:

```bash
docker run --rm -v "$(pwd):/spike" alloy-publishing-spike python3 run_more.py
```

```bash
docker run --rm -v "$(pwd):/spike" alloy-publishing-spike python3 checks_more.py
```

Case 9 needs the image built for arm64 as well, and runs once on each architecture:

```bash
docker buildx build --platform linux/arm64 -t alloy-publishing-spike:arm64 --load .
```

```bash
docker run --rm -v "$(pwd):/spike" alloy-publishing-spike python3 det.py render amd64
```

```bash
docker run --rm --platform linux/arm64 -v "$(pwd):/spike" alloy-publishing-spike:arm64 python3 det.py render arm64
```

```bash
docker run --rm -v "$(pwd):/spike" alloy-publishing-spike python3 det.py compare
```

veraPDF runs over the new PDFs the same way as over the gates' - see `out/pdf/`.

On Windows under Git Bash, prefix each `docker run` with `MSYS_NO_PATHCONV=1` and use `$(pwd -W)`,
or the volume path is rewritten into something Docker cannot find.

Everything lands in `out/`, which is ignored.

## Three things the harness learned the hard way

**Verify a failure before recording it.** The first pass reported that no engine carried a passage's
language, that Typst dropped six footnotes, and that Typst could not break a table. All three were
the harness: Typst records language on marked content rather than a structure element, glues a
footnote's number to its first word, and needs figures declared breakable - the same kind of
template rule the HTML engines were given in CSS. The content model spike recorded a case "declared
passed too early"; this one nearly declared three failed too early.

**The second round did it five more times.** A check that lost track of a page's chapter, a CSS
page-counter reset that WeasyPrint ignores, the same reset making every page reference read 1, a
template rule letting an image part from its caption, and operators set as plain strings in maths.
Eight withdrawn verdicts in all, and every one was found by looking at the page before believing the
number.

**A test that cannot fail is not a test.** An untagged WeasyPrint render is produced as a control,
and veraPDF must reject it. It does, on five rules. Without that, a clean PDF/UA verdict would prove
only that the validator ran.
