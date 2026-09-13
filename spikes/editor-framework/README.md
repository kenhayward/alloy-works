# Editor framework spike

Throwaway. Not part of the pnpm workspace, not in CI, and nothing here is intended to be promoted.

The brief is [`docs/specification/spikes/Editor_Framework_Spike.md`](../../docs/specification/spikes/Editor_Framework_Spike.md);
what came back is [the findings](../../docs/specification/spikes/Editor_Framework_Spike_Findings.md),
and the decision is [ADR-0023](../../docs/decisions/0023-prosemirror-as-the-editor-and-its-model.md).

## Running it

```bash
npm install
node model-gates.mjs          # gate 2, case 5, case 6 - no browser needed
npx esbuild app.mjs --bundle --format=iife --outfile=out/bundle.js
node serve.mjs 8099           # then open http://127.0.0.1:8099/
```

`model-gates.mjs` prints one line per assertion and exits non-zero on a failure. The page reports
into `window.__spike`, and `await window.__axe()` runs axe-core over it.

Two switches on the page:

- `?components=N` - how many components to mount. Default 300, which is what CNT-076 asks for.
- `?resize=off` - disables `columnResizing`. This is the counterfactual for the caption finding: with
  it on, `prosemirror-tables`' own node view builds the table DOM and no `<caption>` is emitted; with
  it off, the same code emits one.

## What is here

| File              | What                                                                          |
| ----------------- | ----------------------------------------------------------------------------- |
| `model-gates.mjs` | The cases that need no browser, with each finding asserted rather than noted  |
| `app.mjs`         | The cases that need a view: many components, an authored table, accessibility |
| `index.html`      | The page, its styles, and the boundary toggle                                 |
| `serve.mjs`       | A static server, because a bundle does not load over `file://`                |

## What it does not do

No manual accessibility audit, which CNT-139 requires alongside the automated suite - and the
findings record that the suite passed a defect the spike found by other means. No IME composition, no
real screen reader, no real document. Cases 7 to 10 of the brief did not run.
