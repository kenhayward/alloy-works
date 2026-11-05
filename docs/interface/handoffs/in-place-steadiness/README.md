# Fix: a component open in place moves its text, and its rule leaves a stub

These are two defects in the document view, seen in Edge on 5 November 2026, Light theme, zoom at
Fit, with a component open in place on the sheet:

1. **Pressing in the open component makes its text shrink slightly**, then grow back when the
   press ends. The text shifts left and up, and further down the component it moves more.
2. **The left rule of the open component** (`.component::before`) **disappears beside its text**,
   leaving it beside the headings and an 8px stub under the text. Moving the pointer past
   components near the open one shows stubs too.

There is no design change. Both should end up exactly as the design already says:

- the text in place is set where the sheet set it, and nothing moves (CNT-075, ADR-0056);
- the rule "moves nothing, and it says which part is open" (`DocumentText.module.css`).

**Out of scope for now:** the red box the editor draws round an emoji (✨) that the read text does
not draw. It is a second editor/read mismatch, and comes back once these two are fixed. Do not
change it here.

## Evidence

The screenshots are not in the repository, as the document they show holds names (no real user data). They were cropped to the sheet:

- `1-open.png`: open in place, before the press;
- `2-pressed.png`: during the press;
- `3-released.png`: after it;
- `compare.png`: the same region side by side, with the end of the second line under each.

What they show:

- **The text scales, it does not just shift.** In `2-pressed`, the second paragraph line ends 11px
  earlier on a 585px line (1193 to 1182 in screen pixels, about 1.9% smaller). The bullets sit 2px
  higher than in `1-open`.
- **Only the open component's text moves.** The sheet's edges and the headings above it do not.
  So the open editor's text is set at a different `--aw-zoom` from the sheet's, for a moment.
- **The rule's gaps line up with the editor's card.** At x=600, the rule is present at y 700 and
  y 856 in `1-open` and `2-pressed`, and absent at y 760 and y 800. It is continuous in
  `3-released`. Those gaps are the height of the in-place editor's card.

## Defect 1: the in-place editor fits its own zoom, from a width its own zoom sets

### Diagnosis (confirm before fixing)

- `ComponentEditor` wraps its surface in `<Canvas sheet={onDone === undefined}>`. **Open in
  place**, that is `sheet={false}`: `useCanvas(surfaceRoom, undefined, false)`.
- At Fit, `useCanvas` computes its **own** zoom: `fitZoom(room(element), measure, false)`, from
  `surfaceRoom`, which is the surface's `clientWidth` less its padding.
- It writes that zoom as its own `--aw-zoom` on the canvas element. That overrides the sheet's
  `--aw-zoom` for everything inside it.
- **In place, the surface's padding is itself set from that `--aw-zoom`**
  (`ComponentEditor.module.css`):

  ```css
  :global(.aw-sheet) .card[data-in-place='true'] .surface {
    padding-inline: calc(var(--sheet-margin) * var(--aw-zoom) - 6pt * var(--aw-zoom));
  }
  ```

  So the room measured depends on the zoom being computed:
  - room = card width - 2 x (margin - 6pt) x z_editor;
  - z_editor' = room / measure.

  Each refit moves z_editor to the other side of its fixed point, which is not the sheet's zoom.

- **The refit runs on every `ResizeObserver` callback** on the canvas element, and those include
  height changes. Pressing in the text changes its height a little: the caret or selection is
  placed, or decorations change. That gives one refit, and the zoom moves one way. Releasing gives
  another, and it moves back.

### Confirm it

Log both zooms on a press and release with a component open in place at Fit:

- the sheet's `--aw-zoom` (`.aw-canvas.aw-sheet`);
- the in-place canvas's `--aw-zoom` (the `.aw-canvas` inside `.card[data-in-place='true']`).

Expect the in-place value to differ from the sheet's, and to change on each press and release,
while the sheet's stays fixed.

If it does not differ, stop. Report what does change on the press instead: the surface's padding,
or a node's metrics. Do not fix the wrong thing.

### Fix

**Open in place, the editor takes the sheet's zoom and measure, and computes none of its own.**

- In place, `Canvas` (or `useCanvas`) sets no `--aw-zoom` and runs no Fit `ResizeObserver`, so the
  surface inherits the sheet's `--aw-zoom` and `--aw-measure`. It still renders the same elements
  and keeps the `aw-canvas` class, so the theme's rules still apply and ProseMirror's mount is never
  remounted (`Canvas.tsx`'s own promise).
- Pick the mechanism that fits the code. One option is a `fit` or `inherit` option on `useCanvas`
  that `Canvas` passes when not a sheet and inside one. Another is to read the sheet's zoom from
  the zoom context. Name the rule in the docblock: "In place, the sheet's zoom: never its own".
- With the editor's zoom equal to the sheet's, the in-place padding rule above puts the text
  exactly where the read text stood. Check that it does: same left edge, same line ends, at Fit and
  at a fixed zoom (75%, 100%, 150%).
- **Anywhere else `useCanvas` fits** (a component on its own page, where `sheet` is true) keeps
  its behaviour.
  - **Guard the feedback anyway:** refit only when the observed **width** changes, comparing
    `contentRect.width` with the last one, not on height changes.
  - **Never read a room** whose padding depends on the zoom being computed. If any caller still
    does, measure the element without that padding, or say in a comment why the padding is fixed
    there.

### Tests

- `Canvas.test.ts` / `useCanvas`: in place inside a sheet, it sets no `--aw-zoom` of its own, and a
  resize does not call `fitZoom`.
- `useCanvas` at Fit: a height-only resize does not refit, and a width change does.
- A browser-level check, if the repo has one (Playwright or similar); otherwise note it as a manual
  check in the PR:
  - open a component in place at Fit;
  - record a paragraph's first and last line boxes;
  - press and release in the text;
  - the boxes are identical.

  Also compare them with the same paragraph's boxes in the read view before opening: identical, or
  within 0.5px.

## Defect 2: the open component's rule is painted over by its own editor

### Diagnosis (confirm before fixing)

- The rule is `.component::before` (`DocumentText.module.css`):
  - `position: absolute`, no `z-index`;
  - `inset-block: -8px` and `inset-inline-start: -8px`, so it starts 8px above, below and left of
    the component's box;
  - its border is `3px` in `--muted` on hover and focus, `--accent` while editing
    (`[data-editing='true']`), and `--ok` just after an assistant change.
- **Open in place, the editor's card is drawn over it:**
  - the card is `position: relative` (`:global(.aw-sheet) .card[data-in-place='true']`);
  - it is later in the tree than the pseudo-element;
  - it is stretched across the sheet's margins (`margin-inline: calc(-1 * var(--sheet-margin) *
var(--aw-zoom))`), so it covers the rule's x.

  Positioned boxes with `z-index: auto` paint in tree order, so the card paints after the rule.
  Anything it holds with a fill covers the rule, alongside the card's height: the theme's page
  colour on `.aw-canvas`, or the surface. That leaves the rule above, beside the headings, and in
  the 8px below: the stub.

- **The neighbours' stubs** are the same 8px overhang above and below each component, running into
  the component before or after it.

### Confirm it

With a component open in place, find what paints over the rule. In DevTools, hide the card's
background or `.aw-canvas`'s background (the theme's page rule, STY-080). The rule appears whole.

### Fix

- **The rule stands above its component's contents:** `z-index: 1` on `.component::before`.
  `.component` is already `position: relative`, so this stays inside the component.
- **Check the gutter:** `.gutter` is also `z-index: 1`. The rule must not cover the gutter's lock
  and comment glyphs. Give the gutter `z-index: 2`, or keep them apart. Check that the glyphs still
  take the pointer (`pointer-events` stays `none` on the rule).
- **No overhang into the neighbours.**
  - Set `inset-block: 0`, so the rule runs the component's own height.
  - Keep the 8px inset to the left: it is in the gutter and touches no other component.
  - If the 8px above and below was there to reach the heading's top and the text's last line, use
    padding on the component, so the rule's extent is its own box.
  - Check that no text moves when the rule shows: the rule is a border on an absolutely positioned
    box, so it never takes space.
- **Forced colours:** the comment's reason for a border (kept in forced colours) still holds.
  Check it in Windows high contrast.

### Tests

There is no CSS paint test in jsdom, so check the rules instead:

- `DocumentText.module.css`: `.component::before` has `z-index` and `inset-block: 0`.
- If the repo snapshots computed styles, add one.
- **Manual check in the PR**, in Light and Dark:
  - open a component in place: its rule runs its whole height, with no gap beside the text;
  - move the pointer down past several components: no stubs above or below any;
  - check the assistant-change rule (`--ok`) the same way.

## One more check while there

In `3-released.png`, after a click inside the open component, the band's toolbar and "Saved" have
gone and the emoji is drawn as the read view draws it. **The editor may have closed on a click
inside it.** Reproduce: open a component in place, then click in its text.

- If it stays open: nothing to do. Say so in the PR.
- If it closes: find why. The `pointedAt` path in `DocumentText.tsx`, `onEmptySheet`, and the
  section `onMouseDown`/`onClick` pair are the likely places. Write a test that a click in an open
  component's text keeps it open, then fix it.

## Order of work

One PR, two commits, each test first:

1. Defect 1: confirm with the zoom log, then the `useCanvas` / `Canvas` change and its tests.
2. Defect 2: confirm in DevTools, then the CSS change and the manual checks.
3. The closing check, and a fix with its test only if it reproduces.

Commit messages name the defect, not the fix ("A component open in place no longer re-fits its own
zoom on a press"). Record the decision in the ADR that owns the in-place sheet (ADR-0056) as a
short amendment: "in place, the editor takes the sheet's zoom, and computes none of its own".
