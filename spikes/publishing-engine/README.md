# Publishing engine spike - harness

> **Throwaway, except the cases.** This is the harness for
> [`Publishing_Engine_Spike.md`](../../docs/specification/Publishing_Engine_Spike.md). The findings
> are in [`Publishing_Engine_Spike_Findings.md`](../../docs/specification/Publishing_Engine_Spike_Findings.md).
> The brief keeps the case set as a regression suite for whichever engine wins; everything else here
> is scaffolding to reach a decision and should not be built on.

Not part of the pnpm workspace, not run by CI, and deliberately so: it needs four PDF engines and a
Java validator that no CI job should have to install.

## What is here

| File             | Does                                                                          |
| ---------------- | ----------------------------------------------------------------------------- |
| `Dockerfile`     | One Linux image holding WeasyPrint, PagedJS, Chromium and Typst               |
| `cases.py`       | The gate cases, each described once and emitted as both XHTML and Typst       |
| `render.py`      | Renders every case with every engine; times the 300-page preview case         |
| `browser.mjs`    | Drives Chromium, with or without PagedJS, for the two browser candidates      |
| `checks.py`      | Judges each rendered PDF from its text positions and structure tree           |
| `experiments.py` | Follow-ups that price a gate failure: the smallest change that might close it |

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

On Windows under Git Bash, prefix each `docker run` with `MSYS_NO_PATHCONV=1` and use `$(pwd -W)`,
or the volume path is rewritten into something Docker cannot find.

Everything lands in `out/`, which is ignored.

## Two things the harness learned the hard way

**Verify a failure before recording it.** The first pass reported that no engine carried a passage's
language, that Typst dropped six footnotes, and that Typst could not break a table. All three were
the harness: Typst records language on marked content rather than a structure element, glues a
footnote's number to its first word, and needs figures declared breakable - the same kind of
template rule the HTML engines were given in CSS. The content model spike recorded a case "declared
passed too early"; this one nearly declared three failed too early.

**A test that cannot fail is not a test.** An untagged WeasyPrint render is produced as a control,
and veraPDF must reject it. It does, on five rules. Without that, a clean PDF/UA verdict would prove
only that the validator ran.
